"""DINOv2-Small attention MIL for knee MR research. No patient deployment."""
import argparse
import csv
import json
import random
from pathlib import Path
from rsna_knee import LABELS, read_rows, series_index, balanced_series, extract_labels, study_slices
from rsna_knee_validation import load_partition

def model_factory(pretrained=True):
    import torch
    from torch import nn
    from transformers import Dinov2Model, Dinov2Config
    if pretrained:
        backbone=Dinov2Model.from_pretrained("facebook/dinov2-small", local_files_only=False)
    else:
        backbone=Dinov2Model(Dinov2Config(
            hidden_size=384, num_hidden_layers=12, num_attention_heads=6,
            intermediate_size=1536, image_size=224, patch_size=14))
    class KneeMIL(nn.Module):
        def __init__(self,backbone):
            super().__init__()
            self.backbone=backbone
            self.attention=nn.Sequential(nn.Linear(384,128),nn.Tanh(),nn.Linear(128,1))
            self.classifier=nn.Linear(384,len(LABELS))
        def forward(self,images):
            # Input normalized using ImageNet/DINOv2 mean and std.
            z=self.backbone(pixel_values=images).last_hidden_state[:,0,:]
            attention=self.attention(z).softmax(dim=0)
            return self.classifier((z*attention).sum(dim=0))
    return KneeMIL(backbone)

def preprocess(x):
    import torch
    mean=torch.tensor([.485,.456,.406],device=x.device).view(1,3,1,1)
    std=torch.tensor([.229,.224,.225],device=x.device).view(1,3,1,1)
    return (x-mean)/std

def main():
    import numpy as np
    import torch
    from torch.nn import functional as F
    from sklearn.metrics import roc_auc_score
    p=argparse.ArgumentParser()
    p.add_argument("--train-csv",required=True)
    p.add_argument("--series-csv",required=True)
    p.add_argument("--dicom-root",required=True)
    p.add_argument("--output",required=True)
    p.add_argument("--epochs",type=int,default=2)
    p.add_argument("--slices",type=int,default=3)
    p.add_argument("--series-limit",type=int,default=3)
    p.add_argument("--lr",type=float,default=2e-5)
    p.add_argument("--seed",type=int,default=42)
    p.add_argument("--manifest",required=True,help="Shared held-out study manifest; mandatory to prevent inconsistent splits")
    p.add_argument("--series-selection",choices=("legacy","balanced"),default="legacy")
    p.add_argument("--no-pretrained",action="store_true")
    args=p.parse_args()
    if not torch.cuda.is_available():raise RuntimeError("GPU required for this experiment")
    random.seed(args.seed);torch.manual_seed(args.seed)
    index=(balanced_series(read_rows(args.series_csv),max_series=args.series_limit)
           if args.series_selection=="balanced" else series_index(read_rows(args.series_csv)))
    rows=[r for r in read_rows(args.train_csv) if
          r["StudyInstanceUID"] in index and any(extract_labels(r)[1])]
    if len(rows)<3:raise RuntimeError("Fewer than 3 labeled studies")
    train,val=load_partition(rows,args.manifest)
    device="cuda"
    model=model_factory(not args.no_pretrained).to(device)
    optimizer=torch.optim.AdamW(model.parameters(),lr=args.lr)
    metrics=[]
    for epoch in range(args.epochs):
        model.train();losses=[];skipped=0
        for row in train:
            uid=row["StudyInstanceUID"]
            try:
                x=study_slices(Path(args.dicom_root),index,uid,args.slices,args.series_limit,
                               series_order="provided" if args.series_selection=="balanced" else "legacy").to(device)
            except ValueError:skipped+=1;continue
            target,mask=extract_labels(row)
            y=torch.tensor(target,device=device)
            m=torch.tensor(mask,device=device)
            optimizer.zero_grad(set_to_none=True)
            logits=model(preprocess(x))
            loss=(F.binary_cross_entropy_with_logits(logits,y,reduction="none")*m).sum()/m.sum().clamp_min(1)
            loss.backward();optimizer.step();losses.append(float(loss.item()))
            del x,logits,loss
        model.eval();truth=[];scores=[];known=[];uids=[]
        with torch.inference_mode():
            for row in val:
                try:
                    x=study_slices(Path(args.dicom_root),index,row["StudyInstanceUID"],args.slices,args.series_limit).to(device)
                except ValueError:continue
                y,m=extract_labels(row)
                uids.append(row["StudyInstanceUID"])
                truth.append(y);known.append(m);scores.append(model(preprocess(x)).sigmoid().cpu().numpy())
        auc={}
        if truth:
            t=np.array(truth);s=np.array(scores);k=np.array(known)
            for j,name in enumerate(LABELS):
                v=k[:,j].astype(bool)
                auc[name]=float(roc_auc_score(t[v,j],s[v,j])) if v.sum()>1 and np.unique(t[v,j]).size==2 else None
        result={"epoch":epoch+1,"loss":sum(losses)/len(losses) if losses else None,
                "skipped":skipped,"val_n":len(truth),"auc":auc}
        print(json.dumps(result),flush=True);metrics.append(result)
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    torch.save({"model":"dinov2-small-mil-v1","labels":list(LABELS),
                "state_dict":{k:v.detach().cpu() for k,v in model.state_dict().items()},
                "slices":args.slices,"series_limit":args.series_limit,
                "series_selection":args.series_selection,"research_only":True},output)
    output.with_suffix(".metrics.json").write_text(json.dumps(metrics,indent=2))
    with output.with_suffix(".validation.csv").open("w",newline="",encoding="utf-8") as f:
        writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);writer.writeheader()
        for uid,prob in zip(uids,scores):
            writer.writerow({"StudyInstanceUID":uid,**dict(zip(LABELS,map(float,prob)))})

if __name__=="__main__":main()
