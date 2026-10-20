#!/usr/bin/env python3
"""Acquire genuine author WMH fold0 asset and configs; no studies or patient content."""
import argparse
import hashlib
import importlib.resources
import json
from pathlib import Path
import shutil

REPO="jil202/wmh_seg"
WEIGHT="checkpoint_final_0_invivo.pth"
MAX_BYTES=500*1024**2

def digest(p):
    h=hashlib.sha256()
    with Path(p).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def manifest_for_metadata(metadata):
    siblings={item.rfilename:item for item in metadata.siblings}
    if WEIGHT not in siblings: raise ValueError("author_original_fold0_missing")
    s=siblings[WEIGHT]
    lfs=getattr(s,"lfs",None)
    if not lfs or not lfs.get("sha256"):
        raise ValueError("publisher_LFS_SHA256_missing")
    if not s.size or not 0<s.size<=MAX_BYTES:
        raise ValueError("publisher_fold0_size_unbounded")
    if not metadata.sha or len(metadata.sha)!=40:
        raise ValueError("source_model_revision_unverified")
    return {"source":"https://huggingface.co/"+REPO,
            "publisherCommit":metadata.sha,"publishedWeightName":WEIGHT,
            "publisherLfsSHA256":lfs["sha256"],"publisherBytes":s.size,
            "originalWeightDownloadVerified":False,"realForwardCompleted":False,
            "clinicalValidation":False,"patientCloudTransfer":False}

def provision(dest):
    from huggingface_hub import model_info,hf_hub_download
    from importlib.metadata import version
    if version("wmh_seg")!="1.6.0":
        raise ValueError("publisher_package_version_mismatch")
    data=model_info(REPO,files_metadata=True,token=False)
    report=manifest_for_metadata(data)
    source=Path(hf_hub_download(REPO,filename=WEIGHT,revision=data.sha,token=False))
    if source.stat().st_size!=report["publisherBytes"] or digest(source)!=report["publisherLfsSHA256"]:
        raise ValueError("download_does_not_match_author_LFS_hash")
    if dest.exists(): raise ValueError("new_model_folder_required")
    dest.mkdir(parents=True)
    for name in ("dataset.json","plans.json"):
        source_cfg=importlib.resources.files("wmh_seg").joinpath("nnunet_assets","invivo",name)
        if not source_cfg.is_file():raise ValueError("bundled_original_config_missing")
        shutil.copyfile(source_cfg,dest/name)
    fold=dest/"fold_0"
    fold.mkdir()
    shutil.copyfile(source,fold/"checkpoint_final.pth")
    report["originalWeightDownloadVerified"]=True
    report["localCheckpointSHA256"]=digest(fold/"checkpoint_final.pth")
    report["nnunetModelDirectory"]=str(dest)
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model-dir",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    a=p.parse_args()
    result=provision(a.model_dir)
    a.report.parent.mkdir(parents=True,exist_ok=True)
    a.report.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"authorWeightVerified":result["originalWeightDownloadVerified"],
                     "sha256":result["localCheckpointSHA256"],"realForward":False}))
if __name__=="__main__":main()
