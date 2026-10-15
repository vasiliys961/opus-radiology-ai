"""Paired study-level bootstrap for experimental knee MRI ROC-AUC comparisons."""
import argparse
import json
import random
from pathlib import Path
from rsna_knee import LABELS,read_rows,extract_labels
from rsna_knee_ensemble import read_prediction
from rsna_knee_validation import binary_auc

def percentile(values,part):
    if not values:return None
    a=sorted(values)
    position=(len(a)-1)*part
    left=int(position);right=min(len(a)-1,left+1)
    return a[left]+(a[right]-a[left])*(position-left)

def score_sample(sample,gold,first,second):
    per_model=[[],[]]
    for j,label in enumerate(LABELS):
        truth=[];a=[];b=[]
        for uid in sample:
            y,mask=gold[uid]
            if mask[j]:
                truth.append(y[j]);a.append(first[uid][j]);b.append(second[uid][j])
        x=binary_auc(truth,a)
        y=binary_auc(truth,b)
        if x is not None and y is not None:
            per_model[0].append(x)
            per_model[1].append(y)
    if not per_model[0]:return None
    return (sum(per_model[0])/len(per_model[0]),
            sum(per_model[1])/len(per_model[1]),
            len(per_model[0]))

def compare(gold_csv,manifest_path,first_csv,second_csv,iterations=2000,seed=42):
    if iterations<1 or iterations>50000:raise ValueError("iterations out of range")
    manifest=json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    ids=manifest["validation"]
    if not ids or len(set(ids))!=len(ids) or set(ids)&set(manifest["train"]):
        raise ValueError("Invalid held-out manifest")
    first=read_prediction(first_csv);second=read_prediction(second_csv)
    if set(ids)!=set(first) or set(ids)!=set(second):
        raise ValueError("Model predictions must match the held-out set")
    raw={r["StudyInstanceUID"]:extract_labels(r) for r in read_rows(gold_csv)}
    if not set(ids)<=set(raw):raise ValueError("Missing reference labels")
    truth={uid:raw[uid] for uid in ids}
    original=score_sample(ids,truth,first,second)
    if original is None:raise ValueError("No class has both outcomes")
    rng=random.Random(seed)
    differences=[];effective_classes=[];discarded=0
    for _ in range(iterations):
        sample=[ids[rng.randrange(len(ids))] for _ in ids]
        result=score_sample(sample,truth,first,second)
        if result is None:discarded+=1;continue
        differences.append(result[1]-result[0]);effective_classes.append(result[2])
    if not differences:raise ValueError("All bootstrap replicates lack comparable classes")
    return {
        "first_macro_auc":original[0],"second_macro_auc":original[1],
        "delta_second_minus_first":original[1]-original[0],
        "bootstrap_paired_delta_95_percentile_interval":[percentile(differences,.025),percentile(differences,.975)],
        "requested_replicates":iterations,"valid_replicates":len(differences),
        "discarded_replicates":discarded,
        "original_evaluable_classes":original[2],
        "bootstrap_evaluable_classes_range":[min(effective_classes),max(effective_classes)],
        "seed":seed,"n_validation":len(ids),
        "warning":"Exploratory study bootstrap on a tiny validation cohort; label prevalence and evaluable classes change by replicate. Not a clinical confidence interval or proof of benefit."
    }

def main():
    p=argparse.ArgumentParser()
    for key in ("gold","manifest","first","second","out"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--iterations",type=int,default=2000)
    p.add_argument("--seed",type=int,default=42)
    a=p.parse_args()
    report=compare(a.gold,a.manifest,a.first,a.second,a.iterations,a.seed)
    out=Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(report,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":
    main()
