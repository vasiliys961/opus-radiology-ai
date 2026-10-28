#!/usr/bin/env python3
"""One-command DICOM FLAIR -> native NIfTI -> original fold-0 WMH inference.

Requires a provisioned pinned wmh_seg CPU worker and licensed public research.
The original FLAIR NIfTI is retained with the predicted mask for source review.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[1]

def module(path):
    spec=importlib.util.spec_from_file_location(path.stem.replace("-","_"),path)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-folder",required=True,type=Path)
    p.add_argument("--out-dir",required=True,type=Path)
    p.add_argument("--model-dir",required=True,type=Path)
    p.add_argument("--checkpoint-sha256",required=True)
    p.add_argument("--public-source-url",required=True)
    p.add_argument("--public-source-license",required=True)
    p.add_argument("--approved-public-research",action="store_true")
    p.add_argument("--flair-protocol-confirmed",action="store_true")
    p.add_argument("--rss-limit-gib",type=float,default=6)
    p.add_argument("--timeout-sec",type=int,default=2400)
    a=p.parse_args()
    if not a.approved_public_research or not a.flair_protocol_confirmed:
        p.error("licensed_public_research_and_verified_FLAIR_required")
    if not a.out_dir.is_dir() or any(a.out_dir.iterdir()):
        p.error("empty_existing_private_output_directory_required")
    converter=module(ROOT/"services/imaging-ai/brain_flair_dicom_to_nifti.py")
    engine=module(ROOT/"scripts/real-brain-flair-wmh-cpu.py")
    source=a.out_dir/"source-flair.nii.gz"
    result=converter.convert_flair(a.dicom_folder,source,protocol_confirmed=True)
    inference=engine.execute(SimpleNamespace(
        flair=source, flair_sha256=result["sourceFLAIRSHA256"],
        model_dir=a.model_dir, checkpoint_sha256=a.checkpoint_sha256,
        mask_out=a.out_dir/"wmh-mask.nii.gz",
        public_source_url=a.public_source_url,
        public_source_license=a.public_source_license,
        approved_public_research=True, flair_protocol_confirmed=True,
        rss_limit_gib=a.rss_limit_gib, timeout_sec=a.timeout_sec,
        expert=None, expert_sha256=None))
    report={"conversion":result,"inference":inference}
    (a.out_dir/"wmh-report.json").write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({"realForward":True,
        "candidateCount":inference["candidateComponentCount"],
        "report":str(a.out_dir/"wmh-report.json"),
        "clinicallyValidated":False}))

if __name__=="__main__": main()
