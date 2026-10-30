#!/usr/bin/env python3
"""Authentic LungSCAPE191 five-fold pretrained inference from one authorized native DICOM CT.

Strict one-series DICOM -> original HU NIfTI -> pinned installed Dataset191 nnU-Net
-> source-native model-label candidates. No Gemini input or diagnostic claims.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

def load(path:Path):
    spec=importlib.util.spec_from_file_location("opus_lungscape_native_module",path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def digest(path:Path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def execute(args):
    if args.output.exists() or args.output.is_symlink():
        raise ValueError("existing_output_not_allowed")
    if not args.public_rights_cleared or not args.deidentified_verified:
        raise ValueError("authorized_deidentified_public_research_CT_required")
    if not args.dicom_folder.is_dir() or args.dicom_folder.is_symlink():
        raise ValueError("original_DICOM_directory_required")
    repo=Path(__file__).resolve().parents[1]
    converter=load(repo/"services/imaging-ai/chest_dicom_to_monai.py")
    runner=load(repo/"scripts/run-lungscape191-research.py")
    with tempfile.TemporaryDirectory(prefix="opus-lungscape191-native-") as d:
        temp=Path(d)
        original=temp/"original.nii"
        converted=converter.convert_dicom_chest(
            args.dicom_folder,original,public_rights=True,deidentified=True)
        if converted["admissionCreated"] is not True:
            raise ValueError("original_CT_not_admitted")
        source_dir=temp/"source"
        source_dir.mkdir()
        compressed=source_dir/"case_0000.nii.gz"
        with original.open("rb") as inp,compressed.open("xb") as raw:
            with gzip.GzipFile(fileobj=raw,mode="wb",filename="",mtime=0) as output:
                while chunk:=inp.read(1024*1024):output.write(chunk)
        original_digest=digest(compressed)
        result=runner.run(compressed,args.nnunet_results,temp/"prediction",
                          device=args.device,execute=True,fold=args.fold)
        if (result.get("status")!="research_mask_generated" or
            result.get("trueOriginalTrainedModelForwardCompleted") is not True or
            result.get("source_sha256")!=original_digest or
            result.get("noIndependentClinicalValidation") is not True):
            raise ValueError("original_LungSCAPE_forward_not_verified")
        if result.get("originalMaskComponentAnalysisCompleted") is not True:
            raise ValueError("LungSCAPE_components_not_verified")
        # Preserve model-specific classifications, including uncertainty, locally.
        # The result is NOT a clinical ILD, UIP, NSIP or GGO diagnosis.
        report={
            "schema":"opus-native-DICOM-lungscape191-real/v1",
            "sourceNativeNiftiSha256":converted["sha256"],
            "compressedInferenceNiftiSha256":original_digest,
            "originalModelForwardCompleted":True,
            "model":"LungSCAPE191",
            "modelLabelsResearchOnly":result.get("originalModelLabelMap"),
            "originalMaskComponentsResearchOnly":result.get("originalMaskConnectedComponentsResearchOnly"),
            "originalMaskComponentAnalysisCompleted":True,
            "originalFoldsExecuted":result.get("actuallyEvaluatedFolds"),
            "sourceDICOMtoModelSopMappingVerified":False,
            "independentClinicalValidation":False,
            "noNegativeDiagnosis":True,
            "researchOnly":True,
            "sourceImagesSentToCloud":False,
        }
        args.output.parent.mkdir(parents=True,exist_ok=True)
        with args.output.open("x",encoding="utf-8") as stream:
            json.dump(report,stream,ensure_ascii=False,indent=2)
        return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-folder",type=Path,required=True)
    p.add_argument("--nnunet-results",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    p.add_argument("--fold",choices=("0","1","2","3","4","all"),default="all")
    p.add_argument("--public-rights-cleared",action="store_true")
    p.add_argument("--deidentified-verified",action="store_true")
    args=p.parse_args()
    result=execute(args)
    print(json.dumps({"realForward":result["originalModelForwardCompleted"],
                      "sourceBound":True,"clinicalValidation":False}))
if __name__=="__main__":main()
