#!/usr/bin/env python3
"""Inspect installed nnU-Net TotalSegmentator checkpoint files, no model execution."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

DATASETS={297:"Dataset297_TotalSegmentator_total_3mm_1559subj",
          298:"Dataset298_TotalSegmentator_total_6mm_1559subj"}
TRAINER="nnUNetTrainer_4000epochs_NoMirroring__nnUNetPlans__3d_fullres"
REQUIRED=("plans.json","dataset.json","fold_0/checkpoint_final.pth")
MAX_CHECKPOINT_BYTES=600*1024*1024

def verify(root):
    root=Path(root)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("invalid_model_root")
    result=[]
    for id,folder in DATASETS.items():
        records=[]
        for relative in REQUIRED:
            path=root/folder/TRAINER/relative
            if path.is_symlink() or not path.is_file():
                raise ValueError("missing_model_file")
            size=path.stat().st_size
            if not 0<size<=MAX_CHECKPOINT_BYTES:
                raise ValueError("invalid_model_file_size")
            digest=hashlib.sha256()
            with path.open("rb") as stream:
                while block:=stream.read(131072):
                    digest.update(block)
            if relative.endswith(".json"):
                with path.open(encoding="utf-8") as f:
                    metadata=json.load(f)
                if not isinstance(metadata,dict):
                    raise ValueError("invalid_metadata")
            records.append({"file":relative,"bytes":size,"sha256":digest.hexdigest()})
        result.append({"dataset":id,"folder":folder,"files":records})
    return {"schema":"opus-totalseg-installed-weights-audit/v1",
            "datasets":result,"realModelExecution":False,
            "independentOfficialProvenanceVerified":False,
            "clinicalStatus":"not_validated"}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--weights-root",required=True,type=Path)
    args=p.parse_args()
    try:
        print(json.dumps(verify(args.weights_root),indent=2))
    except (ValueError,OSError,json.JSONDecodeError):
        print("installed_model_verification_failed",file=sys.stderr)
        return 2
    return 0

if __name__=="__main__":
    raise SystemExit(main())
