"""RSNA Knee MRI research baseline: 12-label study classifier; no API or patient inference."""
import argparse
import csv
import json
import random
from pathlib import Path

LABELS=("ACL","MCL","Medial Meniscus","Lateral Meniscus","Medial OA","Lateral OA","PF OA","Effusion","Synovitis","Baker's","Contusion","Fracture")

def read_rows(path):
    with open(path,encoding="utf-8-sig",newline="") as f:
        return list(csv.DictReader(f))

PLANES=("Sagittal","Coronal","Axial")

def balanced_series(rows,max_series=3):
    """Deterministic round-robin MRI plane selection from CSV metadata.

    Returns the same uid -> list[sid] interface as the legacy series index.
    Unknown planes are excluded. Identifiers never influence plane priority.
    """
    if type(max_series) is not int or max_series < 1:
        raise ValueError("max_series must be a positive integer")
    buckets={}
    for row in rows:
        uid=row["StudyInstanceUID"];sid=row["SeriesInstanceUID"]
        if not uid or not sid or any(x in s for s in (uid,sid) for x in ("..","/","\\") ):
            raise ValueError("Unsafe DICOM identifier")
        plane=row.get("Anatomical_Plane")
        if plane not in PLANES:
            continue
        buckets.setdefault(uid,{}).setdefault(plane,set()).add(sid)
    result={}
    for uid,planes in buckets.items():
        ordered={p:sorted(planes.get(p,())) for p in PLANES}
        selected=[]
        while len(selected)<max_series and any(ordered.values()):
            for plane in PLANES:
                if len(selected)>=max_series:
                    break
                if ordered[plane]:
                    selected.append(ordered[plane].pop(0))
        result[uid]=selected
    return result

def series_index(rows):
    """Legacy interface; keep original series order for old checkpoints."""
    index={}
    for row in rows:
        uid=row["StudyInstanceUID"];sid=row["SeriesInstanceUID"]
        if any(x in item for item in (uid,sid) for x in ("..","/","\\\\") ):
            raise ValueError("Unsafe DICOM identifier")
        if row.get("Anatomical_Plane") not in PLANES:
            continue
        index.setdefault(uid,[]).append(sid)
    return index

def extract_labels(row):
    values=[];mask=[]
    for label in LABELS:
        value=str(row.get(label,"")).strip()
        valid=value in ("0","1","0.0","1.0")
        values.append(float(value) if valid else 0.0)
        mask.append(float(valid))
    return values,mask

def study_slices(root,index,uid,per_series=8,max_series=9):
    import numpy as np
    import pydicom
    import torch
    from PIL import Image
    images=[]
    for sid in sorted(index.get(uid,[]))[:max_series]:
        files=sorted((root/uid/sid).glob("*.dcm"))
        for i in np.linspace(0,len(files)-1,min(len(files),per_series),dtype=int) if files else []:
            try:
                ds=pydicom.dcmread(str(files[int(i)]))
                pixel=ds.pixel_array.astype(np.float32)
                if pixel.ndim!=2:continue
                low,high=np.percentile(pixel,(1,99))
                if high<=low or not np.isfinite(high):continue
                pixel=(np.clip((pixel-low)/(high-low),0,1)*255).astype("uint8")
                pixel=np.asarray(Image.fromarray(pixel).resize((224,224)),dtype=np.float32)/255
                images.append(torch.from_numpy(pixel).unsqueeze(0).repeat(3,1,1))
            except (OSError,ValueError,RuntimeError,AttributeError,ImportError):
                continue
    if not images:raise ValueError("No decodable DICOM series")
    return torch.stack(images)

def new_model(pretrained=None):
    import torch
    from torch import nn
    from torchvision.models import resnet18
    encoder=resnet18(weights=None)
    if pretrained is not None:
        encoder.load_state_dict(torch.load(pretrained,map_location="cpu",weights_only=True),strict=True)
    encoder.fc=nn.Identity()
    class MIL(nn.Module):
        def __init__(self):
            super().__init__()
            self.encoder=encoder
            self.attn=nn.Sequential(nn.Linear(512,128),nn.Tanh(),nn.Linear(128,1))
            self.head=nn.Linear(512,12)
        def forward(self,slices):
            z=self.encoder(slices)
            a=self.attn(z).softmax(0)
            return self.head((z*a).sum(0,keepdim=True)).squeeze(0)
    return MIL()

def run_train(args):
    import numpy as np
    import torch
    from torch.nn import functional as F
    from sklearn.metrics import roc_auc_score
    random.seed(args.seed);torch.manual_seed(args.seed)
    index=series_index(read_rows(args.series))
    rows=[r for r in read_rows(args.csv) if r["StudyInstanceUID"] in index and any(extract_labels(r)[1])]
    if len(rows)<2:raise ValueError("Insufficient explicitly labelled studies; reports are not labels")
    random.shuffle(rows)
    cut=max(1,min(len(rows)-1,int(.8*len(rows))))
    train_rows,val_rows=rows[:cut],rows[cut:]
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model=new_model(args.pretrained).to(device)
    optim=torch.optim.AdamW(model.parameters(),lr=args.lr)
    history=[]
    for epoch in range(args.epochs):
        model.train();losses=[];skipped=0
        random.shuffle(train_rows)
        for row in train_rows:
            try:x=study_slices(Path(args.root),index,row["StudyInstanceUID"],args.slices,args.series_limit).to(device)
            except ValueError:skipped+=1;continue
            y,m=extract_labels(row)
            y=torch.tensor(y,device=device);m=torch.tensor(m,device=device)
            loss=(F.binary_cross_entropy_with_logits(model(x),y,reduction="none")*m).sum()/m.sum().clamp_min(1)
            optim.zero_grad();loss.backward();optim.step()
            losses.append(loss.item())
        model.eval();ys=[];ps=[];ms=[]
        with torch.no_grad():
            for row in val_rows:
                try:x=study_slices(Path(args.root),index,row["StudyInstanceUID"],args.slices,args.series_limit).to(device)
                except ValueError:continue
                y,m=extract_labels(row)
                ys.append(y);ms.append(m);ps.append(model(x).sigmoid().cpu().numpy())
        auc={}
        if ys:
            y=np.array(ys);p=np.array(ps);m=np.array(ms)
            for j,label in enumerate(LABELS):
                selected=m[:,j]==1
                auc[label]=float(roc_auc_score(y[selected,j],p[selected,j])) if selected.sum()>1 and len(set(y[selected,j]))==2 else None
        result={"epoch":epoch+1,"mean_loss":float(np.mean(losses)) if losses else None,"skipped":skipped,"auc":auc}
        print(json.dumps(result));history.append(result)
    Path(args.out).parent.mkdir(parents=True,exist_ok=True)
    torch.save({"architecture":"resnet18-attention-mil-v1","labels":list(LABELS),"state_dict":model.cpu().state_dict(),"slices":args.slices,"series_limit":args.series_limit,"research_only":True},args.out)
    Path(args.out+".metrics.json").write_text(json.dumps(history,indent=2))

def run_predict(args):
    import torch
    checkpoint=torch.load(args.weights,map_location="cpu",weights_only=True)
    if checkpoint.get("architecture")!="resnet18-attention-mil-v1" or checkpoint.get("labels")!=list(LABELS):
        raise ValueError("Unrecognized checkpoint")
    model=new_model();model.load_state_dict(checkpoint["state_dict"])
    device=torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device).eval()
    index=series_index(read_rows(args.series));results=[]
    with torch.no_grad():
        for row in read_rows(args.csv):
            uid=row["StudyInstanceUID"]
            x=study_slices(Path(args.root),index,uid,checkpoint["slices"],checkpoint["series_limit"]).to(device)
            p=model(x).sigmoid().cpu().tolist()
            results.append({"StudyInstanceUID":uid,**dict(zip(LABELS,p))})
    with open(args.out,"w",encoding="utf-8",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
        writer.writeheader();writer.writerows(results)

def main():
    parser=argparse.ArgumentParser()
    sub=parser.add_subparsers(dest="command",required=True)
    for name in ("train","predict"):
        p=sub.add_parser(name)
        for key in ("csv","series","root","out"):p.add_argument("--"+key,required=True)
        if name=="train":
            p.add_argument("--pretrained",help="Local ResNet18 encoder state_dict (offline)")
            p.add_argument("--epochs",type=int,default=3);p.add_argument("--lr",type=float,default=.0001)
            p.add_argument("--seed",type=int,default=42);p.add_argument("--slices",type=int,default=8)
            p.add_argument("--series-limit",type=int,default=9)
        else:p.add_argument("--weights",required=True)
    args=parser.parse_args()
    if args.command=="train":run_train(args)
    else:run_predict(args)

if __name__=="__main__":main()
