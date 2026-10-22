#!/usr/bin/env python3
"""Create physician-review candidate records from authentic LungSCAPE numeric evidence.

No CT pixels, masks, private studies, volumetric claims without source units,
clinical pattern classification, or automated diagnosis.
"""
import argparse
import json
from pathlib import Path

REQUIRED_FALSE = ("independentValidation", "expertDiceComputed",
                  "ggoHoneycombingUIPNSIPSubtypeClassification", "clinicalUsePermitted",
                  "sourcePixelsOrMasksIncludedInArtifact")
MAX_ITEMS = 100

def assemble(report):
    if report.get("schema") != "opus-lungscape191-authentic-public-ct-forward/v1":
        raise ValueError("unrecognized original forward evidence schema")
    if any(report.get(k) is not False for k in REQUIRED_FALSE):
        raise ValueError("missing clinical research-only safeguards")
    if report.get("realOriginalTrainedForward") is not True or report.get("verifiedNativeGrid") is not True:
        raise ValueError("original inference and geometry not verified")
    sha = report.get("sourceSha256")
    if not isinstance(sha,str) or len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
        raise ValueError("missing source CT provenance")
    labels = report.get("originalModelLabelMap")
    regions = report.get("originalModelRegionsNotClinicalDiagnoses")
    if not isinstance(labels, dict) or not isinstance(regions,list) or len(regions)>MAX_ITEMS:
        raise ValueError("invalid model labels/regions")
    candidates=[]
    total=0
    for region in regions:
        ident=region.get("originalModelLabelId")
        count=region.get("voxels")
        bounds=region.get("sourceVoxelBoundsInclusive")
        if not isinstance(ident,int) or ident<1 or not isinstance(count,int) or count<1:
            raise ValueError("invalid model candidate")
        if not isinstance(bounds,list) or len(bounds)!=2 or any(
            not isinstance(row,list) or len(row)!=3 or any(not isinstance(n,int) or n<0 for n in row)
            for row in bounds
        ) or any(lo>hi for lo,hi in zip(*bounds)):
            raise ValueError("invalid source voxel bounds")
        if str(ident) not in labels:
            raise ValueError("unknown original model class")
        volume=region.get("volumeMl")
        ras=region.get("sourceRasMmAxisAlignedBounds")
        if volume is not None and (not isinstance(volume,(int,float)) or volume<0 or not ras):
            raise ValueError("unverified physical size")
        candidates.append({"sourceVoxelBoundsInclusive":bounds,"sourceModelLabel":str(labels[str(ident)]),
                           "modelClassId":ident,"candidateVoxelCount":count,
                           "volumeMlOnlyWhenOriginalUnitsVerified":volume,
                           "sourceRasMmBoundsOnlyWhenVerified":ras,
                           "interpretationStatus":"requires_physician_review",
                           "clinicalDiagnosis":None})
        total+=count
    if total != report.get("observedNonbackgroundModelVoxels"):
        raise ValueError("aggregate model voxel count not reconciled")
    return {"schema":"opus-physician-research-candidates/v1",
            "modality":"CT","sourceSha256":sha,"model":"LungSCAPE191",
            "caseResearchOnly":report.get("publicResearchCase"),
            "findingStatus":"research_candidates_not_diagnosis",
            "modelForwardVerified":True,"sourceGeometryVerified":True,
            "independentAccuracyValidated":False,"notRunDoesNotMeanNegative":True,
            "possibleTrainingOverlap":True,"expertComparisonNotPermittedFromIncompatibleOntology":True,
            "candidates":candidates,"totalNonbackgroundVoxels":total,
            "physicianReportText":None,"patientClinicalUseAllowed":False}

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--evidence",required=True,type=Path)
    a.add_argument("--output",required=True,type=Path)
    p=a.parse_args()
    if p.output.exists():
        raise ValueError("refusing to replace existing physician evidence")
    assembled=assemble(json.loads(p.evidence.read_text()))
    p.output.write_text(json.dumps(assembled,indent=2)+"\n")
    print(json.dumps({"sourceBound":True,"candidates":len(assembled["candidates"]),"clinicalUseAllowed":False}))

if __name__=="__main__":
    main()
