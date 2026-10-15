"""Offline Kaggle full-corpus preflight: inspect actual mounted competition data.

Only aggregate counts are printed. Never copies scans, reports or identifiers.
Requires explicit accepted weak-label CSV before full-corpus training.
"""
import argparse
import json
from pathlib import Path
from rsna_knee import read_rows, extract_labels, LABELS
from rsna_knee_validation import load_partition


def inspect(root, label_csv=None, manifest=None):
    root=Path(root)
    needed=("train.csv","train_series.csv","train_series")
    missing=[name for name in needed if not (root/name).exists()]
    if missing:
        raise FileNotFoundError("Missing competition data: "+", ".join(missing))
    gold=read_rows(root/"train.csv")
    series=read_rows(root/"train_series.csv")
    uids=[row["StudyInstanceUID"] for row in gold]
    if not uids or len(uids)!=len(set(uids)):
        raise ValueError("Empty or duplicate competition studies")
    eligible=set(uids)
    usable={row["StudyInstanceUID"] for row in series if row.get("StudyInstanceUID") in eligible}
    gold_n=sum(any(extract_labels(row)[1]) for row in gold)
    missing_series=len(eligible-usable)
    result={"train_studies":len(gold),"series_rows":len(series),
            "studies_with_series_metadata":len(usable),
            "studies_without_series_metadata":missing_series,
            "gold_labeled_studies":gold_n,
            "labels":list(LABELS),"research_only":True}
    if label_csv or manifest:
        if not label_csv or not manifest:
            raise ValueError("Labels and manifest must be supplied together")
        training_rows=read_rows(label_csv)
        if {r["StudyInstanceUID"] for r in training_rows}!=eligible or len(training_rows)!=len(gold):
            raise ValueError("Training labels do not cover the exact competition train studies")
        train,val=load_partition(training_rows,manifest)
        gold_ids={row["StudyInstanceUID"] for row in gold if any(extract_labels(row)[1])}
        if not {r["StudyInstanceUID"] for r in val}<=gold_ids:
            raise ValueError("Validation contains non-gold cases")
        result["training_cases"]=len(train)
        result["validation_gold_cases"]=len(val)
        result["train_known_label_cells"]=sum(sum(extract_labels(r)[1]) for r in train)
        if len(train)<100:
            result["warning"]="Training corpus still small; full weak-label extraction not complete"
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--competition-root",required=True)
    p.add_argument("--train-csv",default=None)
    p.add_argument("--manifest",default=None)
    p.add_argument("--out",default=None)
    args=p.parse_args()
    summary=inspect(args.competition_root,args.train_csv,args.manifest)
    print(json.dumps(summary,ensure_ascii=False,indent=2))
    if args.out:
        dest=Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(json.dumps(summary,indent=2),encoding="utf-8")


if __name__=="__main__":main()
