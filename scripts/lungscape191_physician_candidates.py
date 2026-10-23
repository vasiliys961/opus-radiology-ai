#!/usr/bin/env python3
"""Create physician-review candidate records from authentic LungSCAPE numeric evidence.

No CT pixels, masks, private studies, volumetric claims without source units,
clinical pattern classification, or automated diagnosis.
"""
import argparse
import json
import re
from pathlib import Path

REQUIRED_FALSE = ("independentValidation", "expertDiceComputed",
                  "ggoHoneycombingUIPNSIPSubtypeClassification", "clinicalUsePermitted",
                  "sourcePixelsOrMasksIncludedInArtifact")
MAX_ITEMS = 100
MIN_COMPONENT_VOXELS = 10

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
    original_mask_sha=report.get("originalPredictionSha256")
    if not isinstance(original_mask_sha,str) or not re.fullmatch("[a-f0-9]{64}",original_mask_sha):
        raise ValueError("original model mask provenance missing")
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
    components=[]
    components_by_class={}
    region_by_class={r["originalModelLabelId"]:r for r in regions}
    raw_components=report.get("originalMaskConnectedComponentsResearchOnly", [])
    if report.get("originalMaskComponentAnalysisCompleted") is True:
        if not isinstance(raw_components,list) or len(raw_components)>400:
            raise ValueError("invalid bounded original-mask components")
        for obj in raw_components:
            if not isinstance(obj,dict) or obj.get("notDiagnosis") is not True or obj.get("connectivity")!=26:
                raise ValueError("component research safeguards missing")
            ident=obj.get("originalModelLabelId")
            voxels=obj.get("voxels")
            bounds=obj.get("sourceVoxelBoundsInclusive")
            if not isinstance(ident,int) or str(ident) not in labels or not isinstance(voxels,int) or voxels<MIN_COMPONENT_VOXELS:
                raise ValueError("invalid original model component")
            if (not isinstance(bounds,list) or len(bounds)!=2 or any(
                not isinstance(row,list) or len(row)!=3 or any(not isinstance(v,int) or v<0 for v in row)
                for row in bounds) or any(a>b for a,b in zip(*bounds))):
                raise ValueError("invalid source component voxel coordinates")
            parent_region=region_by_class.get(ident)
            if parent_region is None or voxels>parent_region["voxels"]:
                raise ValueError("component lacks enclosing original mask class")
            pl,ph=parent_region["sourceVoxelBoundsInclusive"]
            if any(bounds[0][i]<pl[i] or bounds[1][i]>ph[i] for i in range(3)):
                raise ValueError("component lies outside source-bound original class")
            components_by_class[ident]=components_by_class.get(ident,0)+voxels
            if components_by_class[ident]>parent_region["voxels"]:
                raise ValueError("component voxel counts exceed original mask class")
            components.append({"modelClassId":ident,"sourceModelLabel":str(labels[str(ident)]),
                               "sourceVoxelBoundsInclusive":bounds,
                               "candidateVoxelCount":voxels,
                               "sourceVoxelComponentCentroid":obj.get("sourceVoxelComponentCentroid"),
                               "sourceRasMmComponentCentroidOnlyWhenVerified":obj.get("sourceRasMmComponentCentroid"),
                               "volumeMlOnlyWhenOriginalUnitsVerified":obj.get("volumeMl"),
                               "interpretationStatus":"requires_physician_review","clinicalDiagnosis":None})
    if total != report.get("observedNonbackgroundModelVoxels"):
        raise ValueError("aggregate model voxel count not reconciled")
    return {"schema":"opus-physician-research-candidates/v1",
            "modality":"CT","sourceSha256":sha,"originalPredictionSha256":original_mask_sha,"model":"LungSCAPE191",
            "caseResearchOnly":report.get("publicResearchCase"),
            "findingStatus":"research_candidates_not_diagnosis",
            "modelForwardVerified":True,"sourceGeometryVerified":True,
            "independentAccuracyValidated":False,"notRunDoesNotMeanNegative":True,
            "possibleTrainingOverlap":True,"expertComparisonNotPermittedFromIncompatibleOntology":True,
            "candidates":candidates,"individualMaskComponents":components,
            "sourceMaskComponentExtractionCompleted":report.get("originalMaskComponentAnalysisCompleted") is True,
            "totalNonbackgroundVoxels":total,
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
