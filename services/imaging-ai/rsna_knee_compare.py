"""Explicit Kaggle GPU comparison of two MRI models on one held-out cohort.

Uses only local competition DICOM/CSV; never sends reports or data to external APIs.
Pretrained backbones may download public checkpoint files if not cached.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path
from rsna_knee_validation import make_manifest

def training_commands(root,work,manifest,epochs):
    service=Path(__file__).parent
    common=["--train-csv",str(root/"train.csv"),
            "--series-csv",str(root/"train_series.csv"),
            "--dicom-root",str(root/"train_series"),
            "--manifest",str(manifest),"--epochs",str(epochs)]
    return [
        [sys.executable,str(service/"rsna_knee_dinov2.py"),*common,
         "--output",str(work/"dinov2_comparison.pt")],
        [sys.executable,str(service/"rsna_knee_coatnet.py"),*common,
         "--output",str(work/"coatnet_comparison.pt")]
    ]

def run(args):
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("GPU must be enabled before preparing/computing model comparison")
    root=Path(args.root);work=Path(args.work)
    for file in ("train.csv","train_series.csv"):
        if not (root/file).is_file():raise FileNotFoundError(root/file)
    if not (root/"train_series").is_dir():raise FileNotFoundError(root/"train_series")
    work.mkdir(parents=True,exist_ok=True)
    manifest=work/"knee_comparison_split.json"
    make_manifest(root/"train.csv",manifest,args.seed)
    commands=training_commands(root,work,manifest,args.epochs)
    for command in commands:
        print("Executing",Path(command[1]).name,flush=True)
        subprocess.run(command,check=True)
    service=Path(__file__).parent
    dino=work/"dinov2_comparison.validation.csv"
    coat=work/"coatnet_comparison.validation.csv"
    ensemble=work/"knee_ensemble.validation.csv"
    subprocess.run([sys.executable,str(service/"rsna_knee_ensemble.py"),
                    "--dinov2",str(dino),"--coatnet",str(coat),
                    "--out",str(ensemble)],check=True)
    results={}
    for name,file in [("dinov2",dino),("coatnet",coat),("ensemble",ensemble)]:
        output=work/(name+"_comparison_eval.json")
        subprocess.run([sys.executable,str(service/"rsna_knee_validation.py"),"score",
                        "--gold",str(root/"train.csv"),"--manifest",str(manifest),
                        "--predictions",str(file),"--out",str(output)],check=True)
        results[name]=json.loads(output.read_text())
    report=work/"knee_comparison_summary.json"
    report.write_text(json.dumps(results,indent=2))
    print("Comparison saved:",report)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--root",default="/kaggle/input/competitions/rsna-knee-abnormality-detection")
    p.add_argument("--work",default="/kaggle/working")
    p.add_argument("--epochs",type=int,default=2)
    p.add_argument("--seed",type=int,default=42)
    args=p.parse_args()
    if args.epochs<1:raise ValueError("epochs must be >=1")
    run(args)

if __name__=="__main__":main()
