#!/usr/bin/env python3
"""Verify genuine published prostate T2/ADC/HBV tumor nnUNet checkpoint provenance.

Only metadata/weight bytes are inspected. No fabricated prostate tumor inference.
Runs CPU on GitHub Actions; GPU inference is a distinct follow-up phase.
"""
import argparse,hashlib,json
from pathlib import Path
MODEL="cyyu96/AutoMSC-Baselines"
DIR="Dataset004_PICAI/nnUNetCLSTrainerMTL__nnUNetPlans__3d_fullres"
SOURCE="https://huggingface.co/"+MODEL
def admit(dest):
    from huggingface_hub import HfApi,hf_hub_download
    info=HfApi(token=False).model_info(MODEL,token=False,files_metadata=True)
    if len(info.sha)!=40:raise ValueError("model_repository_commit_not_pinned")
    selected=[DIR+"/fold_0/checkpoint_best.pth",DIR+"/dataset.json",DIR+"/plans.json"]
    files={s.rfilename:s for s in info.siblings}
    if any(p not in files for p in selected):raise ValueError("original_prostate_trained_weights_or_plans_missing")
    if not getattr(files[selected[0]],"size",0)>1024*1024:raise ValueError("original_prostate_weights_size_unverified")
    result={"schema":"opus-original-automsc-prostate-mri-weights/v1",
            "modelRepository":MODEL,"modelRevision":info.sha,
            "clinicalTarget":"prostate MRI tumor segmentation + ISUP grading candidate",
            "inputSequenceOrder":["T2","ADC","HBV"],
            "originalSegmentationLabels":{"1":"prostate","2":"tumor"},
            "checkpointRelativePath":selected[0],
            "checkpointBytes":files[selected[0]].size,
            "checkPointFold":"fold_0",
            "trainedForwardPerformed":False,
            "clinicalAccuracyMeasured":False,
            "externalPatientDataSubmitted":False,
            "license":"CC-BY-NC 4.0 research only (PICAI dataset)",
            "compatibilityWarning":"Multimodal 3D nnUNet MTL; no general MRI inference without validated model runtime"}
    # Download the *actual* pretrained author checkpoint; do not execute unsafe pickle.
    p=Path(hf_hub_download(MODEL,filename=selected[0],revision=info.sha,token=False))
    h=hashlib.sha256()
    with p.open("rb") as fd:
        for b in iter(lambda:fd.read(1024*1024),b""):h.update(b)
    if p.stat().st_size!=result["checkpointBytes"]:raise ValueError("checkpoint_lfs_size_changed")
    result["observedOriginalFold0Sha256"]=h.hexdigest()
    if dest.exists():raise ValueError("new_report_destination_required")
    dest.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result))
def main():
    p=argparse.ArgumentParser();p.add_argument("--output",type=Path,required=True)
    a=p.parse_args();admit(a.output)
if __name__=="__main__":main()
