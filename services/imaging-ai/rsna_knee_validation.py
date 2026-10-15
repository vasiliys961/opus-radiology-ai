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

def evaluate(gold_csv,manifest_json,prediction_csv):
    from sklearn.metrics import roc_auc_score
    import numpy as np
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
            outcomes[label]={"auc":float(roc_auc_score(truth,score)),
                             "n":len(truth),"positives":int(sum(truth))}
    valid=[v["auc"] for v in outcomes.values() if v["auc"] is not None]
    return {"macro_auc_observed_classes":float(np.mean(valid)) if valid else None,
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
