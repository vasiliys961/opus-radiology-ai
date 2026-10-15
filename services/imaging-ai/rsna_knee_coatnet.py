"""CoAtNet study-level attention MIL. Research only; checkpoint not included."""
import argparse
import json
import random
from pathlib import Path
from rsna_knee import LABELS, read_rows, series_index, balanced_series, extract_labels, study_slices
from rsna_knee_validation import load_partition

def build_model(pretrained=True, architecture="coatnet_0_rw_224"):
    import torch
    from torch import nn
    import timm
    backbone=timm.create_model(architecture,pretrained=pretrained,num_classes=0)
    dim=backbone.num_features
    class KneeCoAtMIL(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder=backbone
            self.attention=nn.Sequential(nn.Linear(dim,128),nn.Tanh(),nn.Linear(128,1))
            self.classifier=nn.Linear(dim,len(LABELS))
        def forward(self,x):
            features=self.encoder(x)
            if features.ndim>2:features=features.flatten(start_dim=2).mean(dim=-1)
            weight=self.attention(features).softmax(dim=0)
            return self.classifier((weight*features).sum(dim=0))
    return KneeCoAtMIL()

def normalize(images):
    import torch
    mean=torch.tensor((.485,.456,.406),device=images.device).reshape(1,3,1,1)
    std=torch.tensor((.229,.224,.225),device=images.device).reshape(1,3,1,1)
    return (images-mean)/std

def train(args):
    import numpy as np
    import torch
    from torch.nn import functional as F
    from sklearn.metrics import roc_auc_score
    if not torch.cuda.is_available():raise RuntimeError("CUDA GPU required")
    torch.manual_seed(args.seed)
    index=(balanced_series(read_rows(args.series_csv),max_series=args.series_limit)
           if args.series_selection=="balanced" else series_index(read_rows(args.series_csv)))
    rows=[r for r in read_rows(args.train_csv) if r["StudyInstanceUID"] in index and any(extract_labels(r)[1])]
    if len(rows)<3:raise ValueError("Need at least three labeled studies")
    train_rows,val_rows=load_partition(rows,args.manifest)
    model=build_model(not args.no_pretrained,args.architecture).cuda()
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr)
    history=[]
    for epoch in range(args.epochs):
        model.train();losses=[];skipped=0
        for row in train_rows:
            try:x=study_slices(Path(args.dicom_root),index,row["StudyInstanceUID"],args.slices,args.series_limit,
                               series_order="provided" if args.series_selection=="balanced" else "legacy").cuda()
            except ValueError:skipped+=1;continue
            labels,known=extract_labels(row)
            y=torch.tensor(labels,device="cuda");mask=torch.tensor(known,device="cuda")
            opt.zero_grad(set_to_none=True)
            logits=model(normalize(x))
            loss=(F.binary_cross_entropy_with_logits(logits,y,reduction="none")*mask).sum()/mask.sum().clamp_min(1)
            loss.backward();opt.step();losses.append(float(loss.detach()))
        model.eval();target=[];pred=[];known=[];uids=[]
        with torch.inference_mode():
            for row in val_rows:
                try:x=study_slices(Path(args.dicom_root),index,row["StudyInstanceUID"],args.slices,args.series_limit).cuda()
                except ValueError:continue
                y,m=extract_labels(row)
                score=model(normalize(x)).sigmoid().cpu().tolist()
                uids.append(row["StudyInstanceUID"]);target.append(y);pred.append(score);known.append(m)
        metric={}
        if pred:
            t=np.asarray(target);p=np.asarray(pred);k=np.asarray(known)
            for j,label in enumerate(LABELS):
                ok=k[:,j]==1
                metric[label]=float(roc_auc_score(t[ok,j],p[ok,j])) if ok.sum()>=2 and len(set(t[ok,j]))==2 else None
        report={"epoch":epoch+1,"train_loss":sum(losses)/len(losses) if losses else None,"skipped":skipped,
                "val_studies":len(uids),"auc":metric}
        print(json.dumps(report),flush=True);history.append(report)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    torch.save({"architecture":args.architecture,"family":"coatnet-attention-mil-v1",
                "state_dict":{k:v.detach().cpu() for k,v in model.state_dict().items()},
                "labels":list(LABELS),"slices":args.slices,"series_limit":args.series_limit,
                "series_selection":args.series_selection,"research_only":True},out)
    out.with_suffix(".metrics.json").write_text(json.dumps(history,indent=2))
    if pred:
        import csv
        with out.with_suffix(".validation.csv").open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
            for uid,prob in zip(uids,pred):w.writerow({"StudyInstanceUID":uid,**dict(zip(LABELS,prob))})
    print("Saved:",out,flush=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--train-csv",required=True);p.add_argument("--series-csv",required=True)
    p.add_argument("--dicom-root",required=True);p.add_argument("--output",required=True)
    p.add_argument("--epochs",type=int,default=2);p.add_argument("--slices",type=int,default=3)
    p.add_argument("--series-limit",type=int,default=3);p.add_argument("--lr",type=float,default=2e-5)
    p.add_argument("--seed",type=int,default=42)
    p.add_argument("--manifest",required=True,help="Shared held-out study manifest; mandatory to prevent inconsistent splits")
    p.add_argument("--architecture",default="coatnet_0_rw_224")
    p.add_argument("--series-selection",choices=("legacy","balanced"),default="legacy")
    p.add_argument("--no-pretrained",action="store_true")
    train(p.parse_args())
if __name__=="__main__":main()
