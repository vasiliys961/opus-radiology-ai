"""Large-corpus DINOv2 MIL training with frozen encoder, bounded slice batches.

Requires audited 12-label CSV + frozen gold validation manifest. Optional private
local feature cache. No DICOM, identifiers, reports or derived features uploaded.
The saved model uses the existing DINOv2-small-mil-v1 inference contract.
"""
import argparse
import csv
import hashlib
import json
import random
from pathlib import Path

from rsna_knee import LABELS, balanced_series, read_rows, extract_labels, study_slices
from rsna_knee_validation import load_partition
from rsna_knee_finding_mil import make_finding_mil


def configuration(args):
    return {k:getattr(args,k) for k in ("slices","series_limit","pixel_mode",
           "slice_order","seed","lr","series_selection","head")}


def cache_key(uid, options, encoder_id):
    payload=json.dumps([uid,options,encoder_id],sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def save_atomic(torch, obj, path):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    temp=path.with_name(path.name+".partial")
    try:
        torch.save(obj,temp)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def forward_head(model, features):
    weights=model.attention(features).softmax(dim=0)
    return model.classifier((features*weights).sum(dim=0))


def encode_slices(model, images, batch_size, device):
    import torch
    from rsna_knee_dinov2 import preprocess
    features=[]
    with torch.inference_mode():
        for part in images.split(batch_size):
            x=preprocess(part.to(device))
            vector=model.backbone(pixel_values=x).last_hidden_state[:,0,:]
            features.append(vector.detach().cpu())
    return torch.cat(features,dim=0)


def cache_features(model, uid, index, args, device, encoder_id):
    import torch
    key=cache_key(uid,configuration(args),encoder_id)
    path=Path(args.cache_dir)/(key+".pt") if args.cache_dir else None
    if path and path.is_file():
        cached=torch.load(path,map_location="cpu",weights_only=True)
        if cached.get("key")!=key or cached.get("encoder_id")!=encoder_id:
            raise ValueError("Cache checkpoint mismatch")
        features=cached.get("features")
        if not isinstance(features,torch.Tensor) or features.ndim!=2 or features.shape[1]!=384:
            raise ValueError("Malformed feature cache")
        return features.float().to(device)
    images=study_slices(Path(args.dicom_root),index,uid,args.slices,args.series_limit,
                        series_order="provided" if args.series_selection=="balanced" else "legacy",
                        pixel_mode=args.pixel_mode,slice_order=args.slice_order)
    features=encode_slices(model,images,args.slice_batch,device)
    if path:
        save_atomic(torch,{"key":key,"encoder_id":encoder_id,"features":features.half()},path)
    return features.to(device)


def train(args):
    import numpy as np
    import torch
    from torch.nn import functional as F
    from sklearn.metrics import roc_auc_score
    from rsna_knee_dinov2 import model_factory

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA required for full-corpus DINOv2 feature encoding")
    if args.slice_batch<1 or args.epochs<1 or args.slices<1:
        raise ValueError("Invalid batch, epochs or slices")
    random.seed(args.seed);torch.manual_seed(args.seed)
    source=read_rows(args.series_csv)
    index=balanced_series(source,args.series_limit) if args.series_selection=="balanced" else __import__("rsna_knee").series_index(source)
    rows=[r for r in read_rows(args.train_csv) if r["StudyInstanceUID"] in index and any(extract_labels(r)[1])]
    training,validation=load_partition(rows,args.manifest)
    if not training or not validation:
        raise ValueError("Empty train/validation split")
    model=model_factory(pretrained=not bool(args.resume)).cuda()
    encoder_id="facebook/dinov2-small:frozen-v1"
    fingerprint=hashlib.sha256(json.dumps({
        "config":configuration(args),"train":sorted(r["StudyInstanceUID"] for r in training),
        "val":sorted(r["StudyInstanceUID"] for r in validation),
        "encoder":encoder_id
    },sort_keys=True).encode()).hexdigest()
    head=make_finding_mil(384,findings=len(LABELS)).cuda() if args.head=="finding-v2" else None
    trainable=list(head.parameters()) if head is not None else (list(model.attention.parameters())+list(model.classifier.parameters()))
    optimizer=torch.optim.AdamW(trainable,lr=args.lr)
    start=0
    if args.resume:
        checkpoint=torch.load(args.resume,map_location="cpu",weights_only=True)
        if checkpoint.get("trainer_fingerprint")!=fingerprint or checkpoint.get("encoder_id")!=encoder_id:
            raise ValueError("Refusing to resume incompatible training")
        model.load_state_dict(checkpoint["state_dict"],strict=True)
        if head is not None:
            if checkpoint.get("head_family")!="finding-v2":
                raise ValueError("Incompatible finding-specific checkpoint")
            head.load_state_dict(checkpoint["head_state_dict"],strict=True)
        optimizer.load_state_dict(checkpoint["optimizer"])
        start=int(checkpoint["epoch"])
    model.backbone.eval()
    for parameter in model.backbone.parameters():
        parameter.requires_grad_(False)
    out=Path(args.output)
    for epoch in range(start,args.epochs):
        if head is None:
            model.attention.train();model.classifier.train()
        else:
            head.train()
        order=list(training)
        random.Random(args.seed+epoch).shuffle(order)
        losses=[];failed=0
        for row in order:
            uid=row["StudyInstanceUID"]
            try:
                features=cache_features(model,uid,index,args,"cuda",encoder_id)
            except (ValueError,OSError,RuntimeError):
                failed+=1
                continue
            y,known=extract_labels(row)
            target=torch.tensor(y,device="cuda",dtype=torch.float32)
            mask=torch.tensor(known,device="cuda",dtype=torch.float32)
            optimizer.zero_grad(set_to_none=True)
            logits=head(features) if head is not None else forward_head(model,features)
            loss=(F.binary_cross_entropy_with_logits(logits,target,reduction="none")*mask).sum()/mask.sum().clamp_min(1)
            loss.backward();optimizer.step();losses.append(loss.item())
            del features
        if head is None:
            model.attention.eval();model.classifier.eval()
        else:
            head.eval()
        predictions=[];truth=[];known=[]
        with torch.inference_mode():
            for row in validation:
                try:
                    features=cache_features(model,row["StudyInstanceUID"],index,args,"cuda",encoder_id)
                except (ValueError,OSError,RuntimeError):
                    continue
                pred=(head(features) if head is not None else forward_head(model,features)).sigmoid().cpu().tolist()
                y,m=extract_labels(row)
                predictions.append(pred);truth.append(y);known.append(m)
        auc={}
        for j,label in enumerate(LABELS):
            pairs=[(t[j],p[j]) for t,p,k in zip(truth,predictions,known) if k[j]]
            auc[label]=float(roc_auc_score([x[0] for x in pairs],[x[1] for x in pairs])) if len({x[0] for x in pairs})==2 else None
        report={"epoch":epoch+1,"loss":sum(losses)/len(losses) if losses else None,
                "failed_studies":failed,"validation_studies":len(truth),"auc":auc}
        print(json.dumps(report),flush=True)
        state={k:v.detach().cpu() for k,v in model.state_dict().items()}
        checkpoint={"model":"dinov2-small-mil-v1" if head is None else "dinov2-small-finding-mil-v2","state_dict":state,"labels":list(LABELS),
                    "slices":args.slices,"series_limit":args.series_limit,
                    "series_selection":args.series_selection,"pixel_mode":args.pixel_mode,
                    "slice_order":args.slice_order,"research_only":True,
                    "trainer_fingerprint":fingerprint,"encoder_id":encoder_id,
                    "epoch":epoch+1,"optimizer":optimizer.state_dict(),"metrics":report}
        if head is not None:
            checkpoint["head_family"]="finding-v2"
            checkpoint["head_state_dict"]={k:v.detach().cpu() for k,v in head.state_dict().items()}
        save_atomic(torch,checkpoint,out)
    return out


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("train-csv","series-csv","dicom-root","manifest","output"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--cache-dir",default=None)
    p.add_argument("--resume",default=None)
    p.add_argument("--head",choices=("legacy","finding-v2"),default="legacy")
    p.add_argument("--epochs",type=int,default=5)
    p.add_argument("--slices",type=int,default=8)
    p.add_argument("--series-limit",type=int,default=3)
    p.add_argument("--slice-batch",type=int,default=8)
    p.add_argument("--lr",type=float,default=1e-3)
    p.add_argument("--seed",type=int,default=42)
    p.add_argument("--pixel-mode",choices=("legacy","dicom"),default="dicom")
    p.add_argument("--slice-order",choices=("legacy","geometry-v2"),default="geometry-v2")
    p.add_argument("--series-selection",choices=("legacy","balanced"),default="balanced")
    train(p.parse_args())


if __name__=="__main__":
    main()
