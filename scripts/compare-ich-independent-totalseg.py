#!/usr/bin/env python3
"""ONE genuine public NCCT cross-model hemorrhage research comparison.

This does NOT score ICH detection against radiologist truth. The two models
can share biases and the official PHE-SICH-CT-IDS reference masks are EDEMA.
TotalSegmentator cerebral_bleed produces its own binary lesion proposal,
not an independent expert annotation. No patient data or images uploaded.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import nibabel as nib

SRC_SHA="0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95"
MODEL_REPORT="opus-ianpan-genuine-public-ich-research/v1"
OUTPUT_SCHEMA="opus-public-ich-independent-two-model-consistency/v1"
MAX_SOURCE_BYTES=256*1024**2
MAX_MASK_BYTES=64*1024**2
MAX_VOXELS=512*512*128

def sha256(path):
    digest=hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):
            digest.update(block)
    return digest.hexdigest()

def compare(original,mask,report,task_archive_sha256):
    original=Path(original);mask=Path(mask)
    if (not original.is_file() or not mask.is_file() or original.is_symlink() or mask.is_symlink()
        or original.stat().st_size>MAX_SOURCE_BYTES or mask.stat().st_size>MAX_MASK_BYTES
        or sha256(original)!=SRC_SHA):
        raise ValueError("source_identity_or_native_mask_bounds_invalid")
    data=json.loads(Path(report).read_text())
    if (data.get("schema")!=MODEL_REPORT or
        data.get("source",{}).get("niftiSha256")!=SRC_SHA or
        data["source"].get("referenceLabelsOnlyPerihematomalEdema") is not True or
        data["source"].get("sourceOriginalDicomHURescaleIndependentlyVerified") is not False or
        data.get("readyForClinicalUse") is not False or
        data.get("externalExpertHemorrhageLocalizationComparisonPerformed") is not False):
        raise ValueError("not_original_public_ich_pretrained_evidence")
    ct=nib.load(str(original));seg=nib.load(str(mask))
    if (ct.ndim!=3 or seg.ndim!=3 or ct.shape!=seg.shape or
        list(ct.shape)!=data["source"]["sourceDimensionsXYZ"] or
        int(np.prod(ct.shape))>MAX_VOXELS or
        ct.header.get_xyzt_units()[0]!="mm" or
        seg.header.get_xyzt_units()[0]!="mm"):
        raise ValueError("different_original_ct_mask_grid_or_units")
    affine=np.asarray(ct.affine)
    if not np.allclose(affine,np.asarray(seg.affine),atol=.05,rtol=0) or not np.isfinite(affine).all():
        raise ValueError("second_model_not_aligned_to_original_native_ct")
    if seg.header.get_data_dtype().kind not in ("u","i"):
        raise ValueError("second_model_mask_not_integer")
    vox=np.asarray(seg.dataobj)
    if not np.all((vox==0)|(vox==1)):
        raise ValueError("second_model_not_binary_cerebral_bleed")
    measured=(vox==1)
    candidates=[x for x in data["candidates"] if x["class"]=="intraparenchymal" and
                x.get("sourceVoxelProjection") is not None]
    if len(candidates)!=7:
        raise ValueError("genuine_first_model_source_proposals_changed")
    bounds=np.zeros(ct.shape,dtype=np.bool_)
    for item in candidates:
        p=item["sourceVoxelProjection"]
        if p.get("independentlyClinicallyVerified") is not False or p.get("expertMaskCompared") is not False:
            raise ValueError("not_unverified_research_roi")
        b=p["boundingBoxNativeNiftiXYZ"]
        if (len(b)!=6 or any(type(x)!=int or x<0 or x>=ct.shape[i%3] for i,x in enumerate(b))
            or any(b[i]>b[i+3] for i in range(3)) or b[2]!=b[5]):
            raise ValueError("roi_coordinates_invalid")
        bounds[b[0]:b[3]+1,b[1]:b[4]+1,b[2]:b[5]+1]=True
    second_count=int(measured.sum())
    overlap=int(np.count_nonzero(measured&bounds))
    voxel_volume_ml=abs(np.linalg.det(affine[:3,:3]))/1000
    positive_z=np.flatnonzero(np.any(measured,axis=(0,1)))
    return {
      "schema":OUTPUT_SCHEMA,
      "status":"two_genuine_pretrained_models_on_one_original_public_ct_not_expert_validated",
      "originalCtSha256":SRC_SHA,
      "firstModelReportSha256":sha256(report),
      "secondModel":"TotalSegmentator cerebral_bleed",
      "secondModelTask":150,
      "officialWeightsRelease":"v2.0.0-weights",
      "officialWeightsArchiveSha256":task_archive_sha256,
      "secondModelOriginalMaskSha256":sha256(mask),
      "originalShapeXYZ":list(ct.shape),
      "sourceHURescaleIndependentlyVerified":False,
      "originalReferenceLabelsArePerihematomalEdema":True,
      "firstModelSubtypeCandidateBoundingBoxes":len(candidates),
      "secondModelMaskPositiveVoxels":second_count,
      "secondModelUnvalidatedMaskVolumeMl":round(second_count*voxel_volume_ml,6),
      "secondModelSourceSliceIndices":positive_z.astype(int).tolist(),
      "secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion":overlap,
      "secondModelMaskShareWithinFirstModelBounds":round(overlap/second_count,8) if second_count else None,
      "secondModelNegativeDiagnosticConclusionAllowed":False,
      "independentRadiologistGroundTruthPresent":False,
      "segmentationDiceAgainstExpertMask":None,
      "clinicalLesionTruePositive":None,
      "clinicalValidation":False,
      "limitations":[
       "Two models may share correlated bias. Model agreement is not independent medical expertise.",
       "The first model ROIs are bounding boxes, not a blood segmentation.",
       "The public dataset's expert masks are edema, not hemorrhage.",
       "Neither DICOM pixel rescale nor patient-level sensitivity was independently validated."
      ]
    }

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for n in ("original","second-mask","first-report","model-archive-sha256","output"):
        p.add_argument("--"+n,required=True)
    a=p.parse_args()
    if len(a.model_archive_sha256)!=64 or any(x not in "0123456789abcdef" for x in a.model_archive_sha256):
        raise ValueError("actual_model_archive_digest_required")
    result=compare(a.original,a.second_mask,a.first_report,a.model_archive_sha256)
    out=Path(a.output)
    if out.exists() or out.suffix!=".json":
        raise ValueError("new_json_output_required")
    out.write_text(json.dumps(result,indent=2),encoding="utf-8")
    print(json.dumps({k:result[k] for k in (
        "status","secondModelMaskPositiveVoxels","secondModelUnvalidatedMaskVolumeMl",
        "secondModelMaskShareWithinFirstModelBounds","independentRadiologistGroundTruthPresent"
    )}))

if __name__=="__main__":main()
