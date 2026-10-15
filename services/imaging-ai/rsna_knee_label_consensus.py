"""Conservative consensus targets for large-corpus knee MRI research.

Combines TWO independently reviewed report-label JSONL files. Both must agree
on a *stated* positive or negative finding. Missing/uncertain => unknown.
Calibration uses only gold TRAIN cases; gold validation is never read for gates.
No report text, UID, or per-case data is written into diagnostics.
"""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path
from rsna_knee import LABELS, extract_labels, read_rows
from rsna_knee_label_prep import load_jsonl, STATES
from rsna_knee_validation import load_partition


def consensus(gold_csv, manifest_path, first_jsonl, second_jsonl, output_csv,
              min_support=2, min_precision=0.90, min_npv=0.90):
    if min_support<1 or not 0<=min_precision<=1 or not 0<=min_npv<=1:
        raise ValueError("Invalid evidence thresholds")
    rows=read_rows(gold_csv)
    # Strict partition verification prevents training/validation leakage.
    train,val=load_partition(rows,manifest_path)
    validation_ids={r["StudyInstanceUID"] for r in val}
    train_ids={r["StudyInstanceUID"] for r in train}
    original={r["StudyInstanceUID"]:r for r in rows}
    if len(original)!=len(rows):raise ValueError("Duplicate study IDs")
    a=dict(load_jsonl(first_jsonl));b=dict(load_jsonl(second_jsonl))
    if set(a)!=set(original) or set(b)!=set(original):
        raise ValueError("Both annotators must cover exactly the supplied train CSV")
    agreed={}
    for uid in original:
        agreed[uid]={key: STATES[a[uid][key]] if a[uid][key]==b[uid][key] else None for key in LABELS}
    evidence=defaultdict(lambda:{"tp":0,"fp":0,"tn":0,"fn":0})
    for row in train:
        uid=row["StudyInstanceUID"]
        y,m=extract_labels(row)
        for j,key in enumerate(LABELS):
            pred=agreed[uid][key]
            if pred is None or not m[j]:continue
            label="tp" if pred==1 and y[j]==1 else "fp" if pred==1 else "tn" if y[j]==0 else "fn"
            evidence[key][label]+=1
    admitted={}
    for key in LABELS:
        e=evidence[key]
        # Wilson intervals should replace point estimates when enough gold
        # cases become available. Until then, conservative hard lower bounds.
        positive=e["tp"]+e["fp"]
        negative=e["tn"]+e["fn"]
        admitted[key]=positive>=min_support and negative>=min_support and (
            e["tp"]/positive>=min_precision and e["tn"]/negative>=min_npv)
    out=[]
    weak_count=0
    for row in rows:
        uid=row["StudyInstanceUID"]; y,m=extract_labels(row)
        result={"StudyInstanceUID":uid}
        for j,key in enumerate(LABELS):
            if uid in validation_ids:
                # Holdout labels retained only for downstream evaluation,
                # never used by the training partition.
                value=str(int(y[j])) if m[j] else ""
            elif uid in train_ids:
                value=str(int(y[j])) if m[j] else ""
            else:
                pred=agreed[uid][key] if admitted[key] else None
                value="" if pred is None else str(pred)
                weak_count+=int(pred is not None)
            result[key]=value
        out.append(result)
    p=Path(output_csv);p.parent.mkdir(parents=True,exist_ok=True)
    with p.open("w",encoding="utf-8",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
        writer.writeheader();writer.writerows(out)
    summary={"number_of_cases":len(rows),"validation_gold":len(validation_ids),
             "admitted":admitted,"calibration_counts":dict(evidence),
             "weak_label_cells":weak_count,"warning":"Research only; gold train calibration may be too small for safe weak-label use."}
    p.with_suffix(".audit.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    return summary


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ("gold-csv","manifest","annotator-a","annotator-b","output"):
        parser.add_argument("--"+key,required=True)
    parser.add_argument("--min-support",type=int,default=2)
    parser.add_argument("--min-precision",type=float,default=.90)
    parser.add_argument("--min-npv",type=float,default=.90)
    args=parser.parse_args()
    result=consensus(args.gold_csv,args.manifest,args.annotator_a,
                     args.annotator_b,args.output,args.min_support,args.min_precision,args.min_npv)
    print(json.dumps(result))


if __name__=="__main__":
    main()
