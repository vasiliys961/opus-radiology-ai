"""Kaggle CPU-only entrypoint: inspect actual competition report evidence safely.

No GPU, no training, no network, no copies of report text to output.
Writes aggregate JSON and per-study candidate JSONL locally for inspection.
Candidate labels are NOT authorized weak training labels.
"""
import argparse
import json
from pathlib import Path

from rsna_knee_kaggle_preflight import inspect
from rsna_knee_report_evidence import extract
from rsna_knee_report_audit import audit


def run(root,manifest,output):
    root=Path(root)
    out=Path(output)
    summary=inspect(root)
    if summary["train_studies"]<1:raise ValueError("No training studies")
    out.mkdir(parents=True,exist_ok=True)
    candidates=out/"candidate_report_labels.jsonl"
    observed=extract(root/"train.csv",candidates)
    audited=audit(root/"train.csv",manifest,candidates)
    eligible=[name for name,value in audited["classes"].items()
              if value["eligible_for_review"]]
    safe={"competition":summary,"report_candidate_counts":observed["counts"],
          "gold_train_n":audited["gold_train_n"],
          "classes_eligible_for_review":eligible,
          "warnings":[
              "English-only candidate rules; unsupported/ambiguous findings abstain.",
              "Small-gold audit is NOT sufficient for automatic model training.",
              "No model training or competition submission performed."
          ]}
    (out/"cpu_preflight_summary.json").write_text(
        json.dumps(safe,ensure_ascii=False,indent=2),encoding="utf-8")
    return safe


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root",required=True)
    p.add_argument("--manifest",required=True)
    p.add_argument("--output",default="/kaggle/working/opus_knee_cpu")
    args=p.parse_args()
    print(json.dumps(run(args.root,args.manifest,args.output),ensure_ascii=False,indent=2))


if __name__=="__main__":
    main()
