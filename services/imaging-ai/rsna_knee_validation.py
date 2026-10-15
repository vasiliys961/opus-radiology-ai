"""Leakage-aware study manifest + auditable two-model validation, offline only."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
from rsna_knee import LABELS, read_rows, extract_labels
from rsna_knee_ensemble import read_prediction

def split_ids(rows,seed=42,fraction=0.2):
    if not 0<fraction<1:raise ValueError("fraction out of range")
    ids=[r["StudyInstanceUID"] for r in rows if any(extract_labels(r)[1])]
    if len(ids)!=len(set(ids)):raise ValueError("Duplicate study IDs")
    if len(ids)<3:raise ValueError("Too few labeled studies")
    ordered=sorted(ids,key=lambda uid:hashlib.sha256(f"{seed}:{uid}".encode()).hexdigest())
    cut=max(1,min(len(ordered)-1,round(len(ordered)*fraction)))
    return sorted(ordered[cut:]),sorted(ordered[:cut])

def make_manifest(csv_path,output,seed=42):
    rows=read_rows(csv_path)
    train,val=split_ids(rows,seed)
    out=Path(output);out.parent.mkdir(parents=True,exist_ok=True)
    data={"seed":seed,"train":train,"validation":val,"label_schema":list(LABELS),
          "status":"study-level split only; patient/site overlap not excluded"}
    out.write_text(json.dumps(data,indent=2),encoding="utf-8")
    return data

def load_partition(rows,manifest_path):
    """Fail closed unless manifest matches every known labeled study exactly."""
    manifest=json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    if manifest.get("label_schema")!=list(LABELS):
        raise ValueError("Manifest label schema mismatch")
    train=manifest.get("train")
    val=manifest.get("validation")
    if not isinstance(train,list) or not isinstance(val,list) or not train or not val:
        raise ValueError("Empty or malformed study partitions")
    if len(train)!=len(set(train)) or len(val)!=len(set(val)) or set(train)&set(val):
        raise ValueError("Duplicate or overlapping study IDs")
    labeled={r["StudyInstanceUID"]:r for r in rows if any(extract_labels(r)[1])}
    if len(labeled)!=len([r for r in rows if any(extract_labels(r)[1])]):
        raise ValueError("Duplicate labeled study IDs")
    if set(train)|set(val)!=set(labeled):
        raise ValueError("Manifest must cover exactly the eligible labeled studies")
    return [labeled[uid] for uid in train],[labeled[uid] for uid in val]

def binary_auc(truth,scores):
    """Mann-Whitney ROC-AUC with half-credit for ties, no extra dependencies."""
    pos=[p for y,p in zip(truth,scores) if y==1]
    neg=[p for y,p in zip(truth,scores) if y==0]
    if not pos or not neg:return None
    return sum(1 if p>n else 0.5 if p==n else 0 for p in pos for n in neg)/(len(pos)*len(neg))

def evaluate(gold_csv,manifest_json,prediction_csv):
    manifest=json.loads(Path(manifest_json).read_text(encoding="utf-8"))
    val=manifest["validation"]
    if not val or set(val)&set(manifest["train"]):raise ValueError("Train/validation overlap or empty validation")
    gold={r["StudyInstanceUID"]:r for r in read_rows(gold_csv)}
    predictions=read_prediction(prediction_csv)
    if set(predictions)!=set(val):raise ValueError("Predictions must match the held-out IDs exactly")
    if not set(val)<=set(gold):raise ValueError("Missing gold labels")
    outcomes={}
    for j,label in enumerate(LABELS):
        truth=[];score=[]
        for uid in val:
            y,mask=extract_labels(gold[uid])
            if mask[j]:
                truth.append(y[j]);score.append(predictions[uid][j])
        if len(set(truth))<2:
            outcomes[label]={"auc":None,"n":len(truth),"reason":"single_class"}
        else:
            outcomes[label]={"auc":binary_auc(truth,score),
                             "n":len(truth),"positives":int(sum(truth))}
    valid=[v["auc"] for v in outcomes.values() if v["auc"] is not None]
    return {"macro_auc_observed_classes":sum(valid)/len(valid) if valid else None,
            "n_validation":len(val),"evaluable_classes":len(valid),"labels":outcomes,
            "warning":"Not an independent clinical test; 58 gold examples in full dataset."}

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest="command",required=True)
    a=sub.add_parser("split");a.add_argument("--gold",required=True);a.add_argument("--out",required=True)
    a.add_argument("--seed",type=int,default=42)
    b=sub.add_parser("score");b.add_argument("--gold",required=True)
    b.add_argument("--manifest",required=True);b.add_argument("--predictions",required=True)
    b.add_argument("--out",required=True)
    args=p.parse_args()
    if args.command=="split":result=make_manifest(args.gold,args.out,args.seed)
    else:
        result=evaluate(args.gold,args.manifest,args.predictions)
        Path(args.out).write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps(result,ensure_ascii=False))
if __name__=="__main__":main()
