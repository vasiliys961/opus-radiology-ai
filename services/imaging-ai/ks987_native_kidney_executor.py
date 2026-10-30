#!/usr/bin/env python3
"""Original KS987 kidney tumor fold-0 inference on ONE authorized native HU CT.

No expert segmentation required: ordinary inference only. Actual nnUNetv2_predict
and verified publisher original checkpoint are delegated to existing executor.
"""
from __future__ import annotations
import argparse
import gzip
import json
from pathlib import Path
import shutil
import tempfile
import importlib.util

SCRIPT=Path(__file__).resolve().parents[2]/"scripts"/"pancancer_lung_kidney_research.py"

def original():
    spec=importlib.util.spec_from_file_location("ks987_original",SCRIPT)
    if spec is None or spec.loader is None:raise RuntimeError("KS987_original_executor_missing")
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def execute(source:Path,results:Path,device:str="cpu"):
    if source.is_symlink() or not source.is_file() or not source.name.endswith(".nii"):
        raise ValueError("original_native_nii_required")
    if source.stat().st_size>1600*1024**2 or source.stat().st_size<1024:
        raise ValueError("unbounded_native_source")
    if device not in ("cpu","cuda"):raise ValueError("unsupported_device")
    model=original()
    with tempfile.TemporaryDirectory(prefix="opus-ks987-native-") as temp:
        root=Path(temp);inputs=root/"images";inputs.mkdir(mode=0o700)
        target=inputs/"opusrenal_0000.nii.gz"
        with source.open("rb") as inp,gzip.open(target,"wb",compresslevel=1) as out:
            shutil.copyfileobj(inp,out,length=1024*1024)
        outcome=model.run(target,results,root/"prediction","kidney",execute=True,device=device)
        evidence=outcome.get("realModelPrediction",{})
        if (outcome.get("schema")!="opus-original-ks987-pancancer-specific-ct/v1" or
            outcome.get("actualOriginalTrainedForward") is not True or
            outcome.get("originalPretrainedModel",{}).get("checkpointMatchesRealVerifiedPublisherBytes") is not True or
            evidence.get("originalSourceGridVerified") is not True):
            raise ValueError("authentic_native_ks987_forward_not_proven")
        return {"schema":"opus-ks987-native-kidney-forward/v1",
                "sourceNiftiSha256":model.hashfile(source),
                "originalModelForwardCompleted":True,
                "originalCheckpointSHA256":outcome["originalPretrainedModel"]["originalCheckpointSha256"],
                "candidateComponentCount":evidence["candidateComponentCount"],
                "candidateRegions":evidence["candidateRegionsNotConfirmedTumors"],
                "nativeGridVerified":True,"clinicalValidation":False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--nnunet-results",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    p.add_argument("--authorized-original-research",action="store_true")
    args=p.parse_args()
    if not args.authorized_original_research:p.error("explicit research authorization required")
    if args.output.exists() or not args.output.parent.is_dir():p.error("fresh report required")
    doc=execute(args.source,args.nnunet_results,args.device)
    args.output.write_text(json.dumps(doc,indent=2)+"\n")
    print(json.dumps({"originalForward":True,"candidates":doc["candidateComponentCount"]}))

if __name__=="__main__":main()
