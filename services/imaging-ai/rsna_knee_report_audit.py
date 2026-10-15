"""Offline gold-train-only reliability audit for report-label candidates.

No report text/identifiers emitted. Unassessed or unsupported classes remain
ineligible. This module NEVER promotes weak labels automatically.
"""
import argparse
import json
from math import sqrt
from pathlib import Path
from rsna_knee import LABELS,read_rows,extract_labels
from rsna_knee_label_prep import load_jsonl,STATES
from rsna_knee_validation import load_partition

def wilson_lower(success,total,z=1.96):
    if total<=0:return 0.0
    rate=success/total
    return (rate+z*z/(2*total)-z*sqrt(rate*(1-rate)/total+z*z/(4*total*total)))/(1+z*z/total)

def audit(gold_csv,manifest,labels_jsonl,minimum_support=10,lower_bound=.80):
    if minimum_support<1 or not 0<lower_bound<=1:raise ValueError("Invalid audit thresholds")
    rows=read_rows(gold_csv)
    train,_=load_partition(rows,manifest)
    candidates=dict(load_jsonl(labels_jsonl))
    ids={r["StudyInstanceUID"] for r in rows}
    if set(candidates)!=ids:raise ValueError("Candidates must cover exactly original training CSV")
    stats={k:{"tp":0,"fp":0,"tn":0,"fn":0,"unknown":0} for k in LABELS}
    for row in train:
        values,known=extract_labels(row)
        pred=candidates[row["StudyInstanceUID"]]
        for i,key in enumerate(LABELS):
            value=STATES[pred[key]]
            if not known[i] or value is None:
                stats[key]["unknown"]+=1
                continue
            truth=int(values[i])
            label=("tp" if truth else "fp") if value else ("fn" if truth else "tn")
            stats[key][label]+=1
    result={}
    for key,c in stats.items():
        positive=c["tp"]+c["fp"]
        negative=c["tn"]+c["fn"]
        ppv=wilson_lower(c["tp"],positive)
        npv=wilson_lower(c["tn"],negative)
        result[key]={"counts":c,"positive_precision_lower95":ppv,
                     "negative_predictive_lower95":npv,
                     "eligible_for_review":positive>=minimum_support and negative>=minimum_support and
                       ppv>=lower_bound and npv>=lower_bound}
    return {"gold_train_n":len(train),"classes":result,
            "warning":"Training-gold audit only. Not independent clinical validation or automatic training authorization."}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("gold-csv","manifest","labels-jsonl","output"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--minimum-support",type=int,default=10)
    p.add_argument("--lower-bound",type=float,default=.80)
    args=p.parse_args()
    r=audit(args.gold_csv,args.manifest,args.labels_jsonl,args.minimum_support,args.lower_bound)
    out=Path(args.output);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(r,indent=2),encoding="utf-8")
    print(json.dumps({"gold_train_n":r["gold_train_n"],"eligible_classes":sum(v["eligible_for_review"] for v in r["classes"].values())}))
if __name__=="__main__":main()
