#!/usr/bin/env python3
"""Single-command genuine MONAI inference on an authorized native DICOM CT series.

Converts the full DICOM series to HU NIfTI, checks original model provenance,
runs the genuine pretrained MONAI RetinaNet and writes source-bound candidates.
Research-only; no cloud upload, no synthetic result, no patient mode.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import tempfile

from chest_dicom_to_monai import convert_dicom_chest
from monai_bound_nodule import AUTH,run

def analyze_native_dicom(*,dicom_folder:Path,bundle:Path,output:Path,
                          public_rights_cleared:bool,deidentified_verified:bool):
    if not public_rights_cleared or not deidentified_verified:
        raise ValueError("verified_public_rights_and_deidentification_required")
    output=Path(output)
    if output.exists() or not output.parent.is_dir():
        raise ValueError("new_report_path_in_existing_directory_required")
    with tempfile.TemporaryDirectory(prefix="opus-dicom-monai-") as scratch:
        scratch=Path(scratch)
        source=scratch/"converted-ct.nii"
        converted=convert_dicom_chest(Path(dicom_folder),source,
            public_rights=True,deidentified=True)
        if not converted["admissionCreated"]:
            raise ValueError("public_source_admission_missing")
        admission=source.with_suffix(".admission.json")
        report=run(source,admission,Path(bundle),scratch/"model-work",output,AUTH)
        if (report["source"]["sha256"]!=converted["sha256"] or
            report["execution"]["actualPretrainedInferenceCompleted"] is not True):
            raise ValueError("model_not_run_on_converted_dicom_source")
        return {"schema":"opus-native-dicom-monai-run/v1",
                "sourceSha256":converted["sha256"],
                "candidateCount":len(report["candidates"]),
                "modelCompleted":True,"clinicalValidation":False,
                "report":str(output)}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-folder",type=Path,required=True)
    p.add_argument("--bundle",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--public-rights-cleared",action="store_true")
    p.add_argument("--deidentified-verified",action="store_true")
    a=p.parse_args()
    result=analyze_native_dicom(
        dicom_folder=a.dicom_folder,bundle=a.bundle,output=a.output,
        public_rights_cleared=a.public_rights_cleared,
        deidentified_verified=a.deidentified_verified)
    print(json.dumps(result,ensure_ascii=False))
if __name__=="__main__":
    main()
