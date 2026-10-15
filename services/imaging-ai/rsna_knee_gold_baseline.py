"""Frozen gold-only RSNA MRI baseline command planner; CPU validation only.

This launcher validates inputs and prints command; it NEVER starts CUDA.
All training studies must be official gold-labeled; no weak reports accepted.
"""
import argparse
import json
import shlex
import sys
from pathlib import Path
from rsna_knee import read_rows, extract_labels
from rsna_knee_validation import load_partition

def plan(root, manifest, output, epochs=5, slices=8, series_limit=3, slice_batch=8):
    root=Path(root)
    if any(x<1 for x in (epochs,slices,series_limit,slice_batch)):
        raise ValueError("Parameters must be positive")
    rows=read_rows(root/"train.csv")
    train,val=load_partition(rows,manifest)
    if not (root/"train_series.csv").is_file() or not (root/"train_series").exists():
        raise ValueError("Missing DICOM series or metadata")
    if not train or not val:raise ValueError("Empty gold split")
    if any(not any(extract_labels(r)[1]) for r in train+val):
        raise ValueError("Only real gold labels are permitted")
    script=Path(__file__).with_name("rsna_knee_large_train.py")
    command=[sys.executable,str(script),
             "--train-csv",str((root/"train.csv").resolve()),
             "--series-csv",str((root/"train_series.csv").resolve()),
             "--dicom-root",str((root/"train_series").resolve()),
             "--manifest",str(Path(manifest).resolve()),
             "--output",str(Path(output).resolve()),
             "--head","finding-v2",
             "--pixel-mode","dicom",
             "--slice-order","geometry-v2",
             "--series-selection","balanced",
             "--epochs",str(epochs),"--slices",str(slices),
             "--series-limit",str(series_limit),"--slice-batch",str(slice_batch)]
    return {"gold_train":len(train),"gold_validation":len(val),
            "unreviewed_weak_labels":0,"training_started":False,
            "research_only":True,"command":command}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for k in ("root","manifest","output"):p.add_argument("--"+k,required=True)
    for k,v in (("epochs",5),("slices",8),("series-limit",3),("slice-batch",8)):
        p.add_argument("--"+k,type=int,default=v)
    a=p.parse_args()
    result=plan(a.root,a.manifest,a.output,a.epochs,a.slices,a.series_limit,a.slice_batch)
    print(json.dumps({**result,"shell":shlex.join(result["command"])},ensure_ascii=False,indent=2))
if __name__=="__main__":main()
