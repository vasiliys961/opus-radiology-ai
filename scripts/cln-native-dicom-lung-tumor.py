#!/usr/bin/env python3
"""Run genuine pretrained CLN lung tumor model on an approved original DICOM CT folder.

A single isolated Linux CPU research command; never upload DICOM or falsely map
NIfTI RAS candidates to raw SOP UIDs. Explicit source authorization is required.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile

def load(path):
    spec=importlib.util.spec_from_file_location("opus_original_module",path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def run(args):
    if not args.public_rights_cleared or not args.deidentified_verified:
        raise ValueError("licensed_and_deidentified_research_DICOM_required")
    if args.report.exists() or args.report.is_symlink():
        raise ValueError("existing_model_report_must_not_be_overwritten")
    if not args.dicom_folder.is_dir() or args.dicom_folder.is_symlink():
        raise ValueError("original_DICOM_directory_required")
    root=Path(__file__).resolve().parents[1]
    converter=load(root/"services/imaging-ai/chest_dicom_to_monai.py")
    cln=load(root/"scripts/cln-msd-original-ct-cpu.py")
    if not args.checkpoint_sha256 or len(args.checkpoint_sha256)!=64:
        raise ValueError("verified_original_CLN_checkpoint_required")
    with tempfile.TemporaryDirectory(prefix="opus-cln-dicom-") as d:
        temp=Path(d)
        nii=temp/"source.nii"
        admission=converter.convert_dicom_chest(args.dicom_folder,nii,
            public_rights=True,deidentified=True)
        if admission["admissionCreated"] is not True:
            raise ValueError("CT_source_not_admitted")
        zipped=temp/"original.nii.gz"
        with nii.open("rb") as source,zipped.open("xb") as target:
            with gzip.GzipFile(filename="",mode="wb",fileobj=target,mtime=0) as output:
                while block:=source.read(1024*1024):
                    output.write(block)
        from argparse import Namespace
        model=cln.infer(Namespace(
            approved_public_source=True,ct=zipped,source_sha256=digest(zipped),
            model_dir=args.model_dir,checkpoint_sha256=args.checkpoint_sha256,
            output=temp/"prediction",expert=None,
            memory_gib=args.memory_gib,timeout_sec=args.timeout_sec))
        if model.get("realOriginalModelForwardCompleted") is not True:
            raise ValueError("actual_CLN_forward_not_verified")
        report={
            "schema":"opus-original-CLN-native-DICOM-lung-tumor/v1",
            "sourceDicomNiftiSha256":admission["sha256"],
            "inferenceSourceNiftiGzipSha256":digest(zipped),
            "checkpointSha256":args.checkpoint_sha256,
            "originalModelForwardCompleted":True,
            "sourceDicomGeometryAccepted":True,
            "originalDicomSopRegistrationVerified":False,
            "researchOnly":True,"clinicalValidation":False,
            "negativeDiagnosisPermitted":False,
            "sourceImageFilesUploadedToCloud":False,
            "candidateCount":model["modelTumorComponentCount"],
            "nativeCandidates":model["sourceNativeTumorCandidates"],
            "candidateListTruncated":model["modelComponentsTruncated"],
            "voxelDice":None,"independentExpertReferenceAvailable":False,
            "limitations":["Research pretrained CLN, not clinically validated",
                "DICOM SOP-to-NIfTI lesion mapping not independently validated",
                "No expert mask for this source; candidate count is not diagnosis",
                "No detection does not exclude lung tumor"],
        }
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(report,indent=2)+"\n")
        return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-folder",type=Path,required=True)
    p.add_argument("--model-dir",type=Path,required=True)
    p.add_argument("--checkpoint-sha256",required=True)
    p.add_argument("--report",type=Path,required=True)
    p.add_argument("--public-rights-cleared",action="store_true")
    p.add_argument("--deidentified-verified",action="store_true")
    p.add_argument("--memory-gib",type=float,default=11)
    p.add_argument("--timeout-sec",type=int,default=3300)
    a=p.parse_args()
    report=run(a)
    print(json.dumps({"realForward":report["originalModelForwardCompleted"],
        "candidates":report["candidateCount"],"clinicalValidation":False}))
if __name__=="__main__":
    main()
