"""Fail-closed Kaggle GPU launcher for audited RSNA Knee research training.

Usage:
 python services/imaging-ai/rsna_knee_kaggle_train.py \
   --competition-root /kaggle/input/competitions/rsna-knee-abnormality-detection \
   --labels /kaggle/working/knee-labels.csv \
   --manifest /kaggle/working/knee-manifest.json \
   --output /kaggle/working/opus-finding-v2.pt

No cloud API, no report transfer, no automatic weak-label fabrication.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

from rsna_knee import LABELS, read_rows, extract_labels
from rsna_knee_kaggle_preflight import inspect
from rsna_knee_validation import load_partition


def prepare(args):
    root=Path(args.competition_root).resolve()
    report=inspect(root,args.labels,args.manifest)
    rows=read_rows(args.labels)
    train,val=load_partition(rows,args.manifest)
    gold={r["StudyInstanceUID"]:r for r in read_rows(root/"train.csv")}
    gold_ids={uid for uid,r in gold.items() if any(extract_labels(r)[1])}
    weak_train=[r for r in train if r["StudyInstanceUID"] not in gold_ids]
    count=sum(any(extract_labels(r)[1]) for r in weak_train)
    if count<args.min_weak_studies:
        raise ValueError(
            f"Only {count} weak-labeled training studies; "
            f"require at least {args.min_weak_studies}. "
            "Complete approved report labeling before spending Kaggle GPU.")
    if report["studies_without_series_metadata"]:
        raise ValueError("Missing series metadata; resolve before GPU training")
    if len(val)<2:
        raise ValueError("Gold validation too small for credible experiment")
    if args.slices<1 or args.series_limit<1 or args.slice_batch<1 or args.epochs<1:
        raise ValueError("Positive training parameters required")
    if args.resume and not Path(args.resume).is_file():
        raise FileNotFoundError("Resume checkpoint not mounted")
    script=Path(__file__).with_name("rsna_knee_large_train.py")
    command=[sys.executable,str(script),
        "--train-csv",str(Path(args.labels).resolve()),
        "--series-csv",str(root/"train_series.csv"),
        "--dicom-root",str(root/"train_series"),
        "--manifest",str(Path(args.manifest).resolve()),
        "--output",str(Path(args.output).resolve()),
        "--head","finding-v2","--pixel-mode","dicom",
        "--slice-order","geometry-v2","--series-selection","balanced",
        "--epochs",str(args.epochs),"--slices",str(args.slices),
        "--series-limit",str(args.series_limit),"--slice-batch",str(args.slice_batch)]
    if args.cache_dir:command.extend(["--cache-dir",str(Path(args.cache_dir).resolve())])
    if args.resume:command.extend(["--resume",str(Path(args.resume).resolve())])
    summary={"gold_validation":len(val),"weak_training_studies":count,
             "total_training_studies":len(train),"mode":"finding-v2",
             "approved_labels_required":True,"research_only":True}
    return command,summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("competition-root","labels","manifest","output"):
        p.add_argument("--"+name,required=True)
    p.add_argument("--cache-dir")
    p.add_argument("--resume")
    p.add_argument("--epochs",type=int,default=5)
    p.add_argument("--slices",type=int,default=8)
    p.add_argument("--series-limit",type=int,default=3)
    p.add_argument("--slice-batch",type=int,default=8)
    p.add_argument("--min-weak-studies",type=int,default=500)
    p.add_argument("--dry-run",action="store_true")
    args=p.parse_args()
    if args.min_weak_studies<1:raise ValueError("Need positive minimum weak study threshold")
    command,summary=prepare(args)
    print(json.dumps(summary,indent=2),flush=True)
    if args.dry_run:
        print("Dry run passed; no GPU training started.")
        return
    subprocess.run(command,check=True)


if __name__=="__main__":
    main()
