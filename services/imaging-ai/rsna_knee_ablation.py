"""Knee MRI ablation matrix: one controlled change at a time.

Runs four DINOv2-only experiments with the same gold study manifest and
independent output directories. Original competition files never leave Kaggle.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from rsna_knee_validation import make_manifest

EXPERIMENTS=(
    ("baseline", "legacy", "legacy", False),
    ("balanced_planes", "balanced", "legacy", False),
    ("dicom_pixels", "legacy", "dicom", False),
    ("balanced_loss", "legacy", "legacy", True),
)

def build_commands(root,work,manifest,epochs,seed):
    service=Path(__file__).parent
    commands=[]
    for name,selection,pixel,balance in EXPERIMENTS:
        output=work/name/"dinov2.pt"
        cmd=[sys.executable,"-u",str(service/"rsna_knee_dinov2.py"),
             "--train-csv",str(root/"train.csv"),
             "--series-csv",str(root/"train_series.csv"),
             "--dicom-root",str(root/"train_series"),
             "--manifest",str(manifest),"--output",str(output),
             "--epochs",str(epochs),"--seed",str(seed),
             "--series-selection",selection,"--pixel-mode",pixel]
        if balance:cmd.append("--class-balance")
        commands.append((name,cmd,output))
    return commands

def run(args):
    root=Path(args.root);work=Path(args.work)
    if not 1<=args.epochs<=10:raise ValueError("epochs must be 1..10")
    if args.seed<0:raise ValueError("seed must be non-negative")
    if not (root/"train_series").is_dir():raise FileNotFoundError(root/"train_series")
    for filename in ("train.csv","train_series.csv"):
        if not (root/filename).is_file():raise FileNotFoundError(root/filename)
    if args.dry_run:
        commands=build_commands(root,work,work/"shared_split.json",args.epochs,args.seed)
        for name,cmd,_ in commands:print(name," ".join(cmd))
        return
    import torch
    if not torch.cuda.is_available():raise RuntimeError("GPU required")
    work.mkdir(parents=True,exist_ok=True)
    manifest=work/"shared_split.json"
    make_manifest(root/"train.csv",manifest,args.seed)
    commands=build_commands(root,work,manifest,args.epochs,args.seed)
    records=[]
    service=Path(__file__).parent
    for name,command,output in commands:
        output.parent.mkdir(parents=True,exist_ok=True)
        print("START:",name,flush=True)
        subprocess.run(command,check=True)
        validation=output.with_suffix(".validation.csv")
        assessment=output.parent/"auc.json"
        subprocess.run([sys.executable,str(service/"rsna_knee_validation.py"),
                        "score","--gold",str(root/"train.csv"),
                        "--manifest",str(manifest),"--predictions",str(validation),
                        "--out",str(assessment)],check=True)
        score=json.loads(assessment.read_text())
        records.append({"experiment":name,"macro_auc":score["macro_auc_observed_classes"],
                        "evaluable_classes":score["evaluable_classes"],
                        "n_validation":score["n_validation"]})
        summary=work/"ablation_summary.json"
        summary.write_text(json.dumps({"seed":args.seed,"epochs":args.epochs,
                                       "runs":records,"exploratory_only":True},indent=2))
        print("FINISHED",name,"macro AUC",records[-1]["macro_auc"],flush=True)
    print("REPORT:",work/"ablation_summary.json",flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root",default="/kaggle/input/competitions/rsna-knee-abnormality-detection")
    p.add_argument("--work",default="/kaggle/working/knee_ablation_v1")
    p.add_argument("--epochs",type=int,default=2)
    p.add_argument("--seed",type=int,default=42)
    p.add_argument("--dry-run",action="store_true")
    run(p.parse_args())

if __name__=="__main__":main()
