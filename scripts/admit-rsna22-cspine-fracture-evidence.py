#!/usr/bin/env python3
"""Admit original RSNA22 cervical-fracture model research probabilities only.

Research adapter, NOT a trained forward, localization or clinical deployment.
Accept author-inference CSV with one row and seven vertebra probabilities.
Patient and StudyInstanceUID never leave the private worker in the numeric report.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sys

VERTEBRAE = tuple("C"+str(i) for i in range(1,8))
FIELDS = ("StudyInstanceUID","patient_overall",*VERTEBRAE)
SHA = re.compile(r"^[0-9a-f]{64}$")


def convert(csv_path, *, exact_study_uid, original_dicom_manifest_sha, original_model_checkpoint_sha):
    for kind,value in (("DICOM manifest",original_dicom_manifest_sha),
                       ("trained checkpoint",original_model_checkpoint_sha)):
        if not SHA.fullmatch(value):
            raise ValueError(kind+" original SHA256 required")
    if not isinstance(exact_study_uid,str) or not re.fullmatch(r"[0-9]+(?:\\.[0-9]+)+",exact_study_uid):
        raise ValueError("exact private DICOM StudyInstanceUID must be numeric OID")
    p=Path(csv_path)
    if p.is_symlink() or not p.is_file() or p.stat().st_size>1024*1024:
        raise ValueError("prediction CSV must be one bounded ordinary private file")
    with p.open(newline="",encoding="utf8") as f:
        reader=csv.DictReader(f)
        if reader.fieldnames is None or set(reader.fieldnames)!=set(FIELDS) or len(reader.fieldnames)!=len(FIELDS):
            raise ValueError("expected exact publisher-compatible study + 7 vertebrae + overall columns")
        rows=list(reader)
    if len(rows)!=1 or rows[0]["StudyInstanceUID"]!=exact_study_uid:
        raise ValueError("not one exactly source-bound DICOM study")
    result={}
    for key in ("patient_overall",*VERTEBRAE):
        try:
            raw=rows[0][key]
            v=float(raw)
        except (TypeError, ValueError) as e:
            raise ValueError("invalid research probability for "+key) from e
        if not math.isfinite(v) or v<0 or v>1:
            raise ValueError("fracture probability outside [0,1]: "+key)
        result[key]=round(v,9)
    digest=hashlib.sha256(p.read_bytes()).hexdigest()
    return {
        "schema":"opus-rsna22-cspine-fracture-research-evidence/v1",
        "clinicalTarget":"cervical-spine-fracture-CT",
        "modelResultCsvSha256":digest,
        "originalSourceDicomManifestSha256":original_dicom_manifest_sha,
        "originalPublisherCheckpointSha256ProvidedNotIndependentlyVerified":original_model_checkpoint_sha,
        "authorResearchProbabilities":result,
        "labels":list(VERTEBRAE),
        "patientStudyIdentifierIncluded":False,
        "perVertebraMaskOrVoxelLocalizationAvailable":False,
        "actualTrainedModelForwardIndependentlyVerified":False,
        "sourceHashesIndependentlyVerified":False,
        "clinicalDiagnosisOrAbsenceConfirmed":False,
        "researchOnly":True,
        "humanReviewRequired":True,
        "independentClinicalValidation":False,
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv",type=Path,required=True)
    p.add_argument("--private-study-uid",required=True)
    p.add_argument("--dicom-manifest-sha256",required=True)
    p.add_argument("--checkpoint-sha256",required=True)
    p.add_argument("--output-numeric",type=Path,required=True)
    a=p.parse_args()
    try:
        result=convert(a.csv,exact_study_uid=a.private_study_uid,
            original_dicom_manifest_sha=a.dicom_manifest_sha256,
            original_model_checkpoint_sha=a.checkpoint_sha256)
        if a.output_numeric.exists():
            raise ValueError("refuse stale output")
        a.output_numeric.write_text(json.dumps(result,indent=2)+"\n",encoding="utf8")
        print("C-spine research probabilities admitted for physician review; "
              "true model forward and original source still unverified.")
        return 0
    except (OSError,ValueError) as e:
        print("Fracture research evidence REJECTED: "+str(e),file=sys.stderr)
        return 1


if __name__=="__main__":
    raise SystemExit(main())
