#!/usr/bin/env python3
"""Research evidence for a *genuine* pretrained TotalSegmentator lung_nodules run.

Accept only exact public LUNA16 positive CT already used by the established
MONAI reference. Distinguishes lung-anatomy label 1 from nodule label 2.
No probabilities, diagnoses, sensitivity or unseen-FROC claims. Does NOT
run a model itself; called only after a separate successful real model job.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

SOURCE_SHA="9ffdf6b61da27d6d505e04f5ebdf9245915216fa177b20f7ab8b4756869f7737"
ORIGINAL_RAW_SHA="ca3c712205e3e8a2d9f5cbc19615a7b47c757ccf2a6b5b9b6a4e15ec0d70afc5"
EXPERT_LPS=(-64.11833,-4.88744,-85.90245)
EXPERT_DIAMETER_MM=5.10512
MAX_MASK_BYTES=256*1024**2
MAX_CT_BYTES=512*1024**2

def file_hash(p:Path):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""): h.update(chunk)
    return h.hexdigest()

def bounded(p:Path,limit:int)->Path:
    if p.is_symlink() or not p.is_file() or not 0<p.stat().st_size<=limit:
        raise ValueError("unverified_bounded_public_file")
    return p

def read_public_reference(reference:Path):
    obj=json.loads(bounded(reference,32768).read_text())
    if (obj.get("schema")!="opus-monai-luna16-independent-expert-center-comparison/v1" or
        obj.get("study",{}).get("sourceRawSha256")!=ORIGINAL_RAW_SHA or
        obj.get("independentPublishedLuna16ExpertReference",{}).get("standard")!=
          "published_centroid_and_diameter_not_expert_voxel_mask"):
        raise ValueError("published_original_luna16_reference_not_verified")
    exp=obj["independentPublishedLuna16ExpertReference"]
    if (len(exp["centerLpsMm"])!=3 or
        any(abs(float(a)-b)>0.00001 for a,b in zip(exp["centerLpsMm"],EXPERT_LPS)) or
        abs(float(exp["diameterMm"])-EXPERT_DIAMETER_MM)>0.00001):
        raise ValueError("published_reference_coordinates_changed")
    return obj

def validate_native_model_mask(source:Path, mask:Path):
    import nibabel as nib
    import numpy as np
    from scipy import ndimage
    if file_hash(bounded(source,MAX_CT_BYTES))!=SOURCE_SHA:
        raise ValueError("unexpected_original_source_nifti_hash")
    bounded(mask,MAX_MASK_BYTES)
    orig=nib.load(str(source));seg=nib.load(str(mask))
    if (orig.ndim!=3 or seg.ndim!=3 or
        orig.shape!=(512,512,109) or seg.shape!=orig.shape or
        orig.header.get_xyzt_units()[0]!="mm" or
        seg.header.get_xyzt_units()[0]!="mm" or
        seg.header.get_data_dtype().kind not in ("u","i")):
        raise ValueError("native_original_lung_ct_or_integer_model_mask_required")
    a=np.asarray(orig.affine,dtype=np.float64)
    b=np.asarray(seg.affine,dtype=np.float64)
    if (not np.isfinite(a).all() or not np.isfinite(b).all() or
        abs(np.linalg.det(a[:3,:3]))<0.0001):
        raise ValueError("noninvertible_native_ct_grid")
    for i in (0,511):
        for j in (0,511):
            for k in (0,108):
                point=np.array([i,j,k,1],dtype=np.float64)
                if np.linalg.norm((a@point)[:3]-(b@point)[:3])>0.05:
                    raise ValueError("trained_mask_not_registered_to_original_ct_grid")
    slope=seg.dataobj.slope; intercept=seg.dataobj.inter
    if (slope is not None and not np.isclose(slope,1)) or (
        intercept is not None and not np.isclose(intercept,0)):
        raise ValueError("scaled_model_labels_not_allowed")
    data=np.asarray(seg.dataobj)
    if not np.isfinite(data).all() or not np.isin(data,[0,1,2]).all():
        raise ValueError("model_must_output_only_background_lung_nodule_labels")
    # Published expert center in DICOM LPS; nibabel spatial matrix is RAS.
    expert_ras=np.array([-EXPERT_LPS[0],-EXPERT_LPS[1],EXPERT_LPS[2]])
    center=np.linalg.solve(a[:3,:3],expert_ras-a[:3,3])
    if np.any(center<-0.5) or np.any(center>np.array(orig.shape)-0.5):
        raise ValueError("published_expert_reference_outside_original_grid")
    nodule=(data==2)
    total=int(np.count_nonzero(nodule))
    # A real task-315 mask or ordinary lung anatomy MUST NOT be interpreted
    # as a lung_nodules result. Label 1 never counts as pathology.
    anatomy=int(np.count_nonzero(data==1))
    # 26-connected real output components; omit very large per-component arrays.
    labeled,n_components=ndimage.label(nodule,structure=np.ones((3,3,3),dtype=bool))
    sizes=np.bincount(labeled.ravel(),minlength=n_components+1)
    sizes[0]=0
    top=sorted(range(1,n_components+1),key=lambda i:int(sizes[i]),reverse=True)[:12]
    boxes=ndimage.find_objects(labeled)
    voxel_volume=abs(float(np.linalg.det(a[:3,:3])))
    components=[]
    for cid in top:
        sl=boxes[cid-1]
        if sl is None:continue
        local=labeled[sl]==cid
        coord=np.argwhere(local).astype(np.float64)
        offset=np.array([part.start for part in sl])
        centroid=coord.mean(axis=0)+offset
        ras=a[:3,:3]@centroid+a[:3,3]
        lps=[-float(ras[0]),-float(ras[1]),float(ras[2])]
        components.append({
            "modelComponentRankBySize":len(components)+1,
            "modelNoduleVoxels":int(sizes[cid]),
            "modelUnvalidatedComponentVolumeMm3":round(float(sizes[cid])*voxel_volume,3),
            "centerLpsMm":[round(v,3) for v in lps],
            "centerDistanceToPublishedExpertMm":round(float(np.linalg.norm(ras-expert_ras)),3),
            "clinicalNoduleConfirmed":False})
    # Select a small native ROI around expert point rather than generating
    # all detected positive-voxel world coordinates for the entire volume.
    edge=np.linalg.norm(a[:3,:3],axis=0)
    half=np.ceil(12/edge).astype(int)+1
    lo=np.maximum(np.floor(center).astype(int)-half,0)
    hi=np.minimum(np.ceil(center).astype(int)+half+1,np.array(orig.shape))
    roi=nodule[lo[0]:hi[0],lo[1]:hi[1],lo[2]:hi[2]]
    coords=np.argwhere(roi)
    if len(coords):
        native=coords+lo
        ras=(a[:3,:3]@native.T).T+a[:3,3]
        nearest=float(np.linalg.norm(ras-expert_ras,axis=1).min())
    else: nearest=None
    return {
        "originalCtSha256":SOURCE_SHA,
        "modelOutputMaskSha256":file_hash(mask),
        "nativeCtDimensions":[512,512,109],
        "originalCtAndMaskRegisteredAtEightCorners":True,
        "publishedExpertCenterLpsMm":list(EXPERT_LPS),
        "publishedExpertDiameterMm":EXPERT_DIAMETER_MM,
        "expertReferenceWasHeldOutFromTraining":False,
        "anatomicalLungLabel1VoxelsNotPathology":anatomy,
        "noduleLabel2VoxelCount":total,
        "modelLabel2ConnectedComponents":int(n_components),
        "largestModelComponents":components,
        "nearestModelNoduleVoxelToPublishedExpertCenterWithin12Mm":
          None if nearest is None else round(nearest,3),
        "modelMaskWithin5MmOfPublishedExpertCenter":
          bool(nearest is not None and nearest<=5),
        "noNodulesMeansNoDisease":False,
        "expertLesionContourPresent":False,
        "independentExternalSensitivityOrFrocEstablished":False,
        "clinicalValidation":False}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",required=True,type=Path)
    p.add_argument("--reference",required=True,type=Path)
    p.add_argument("--mask",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--weights-sha256",required=True)
    args=p.parse_args()
    if (args.output.exists() or args.output.is_symlink() or
        not args.output.parent.is_dir()):
        raise ValueError("numeric_output_must_be_new")
    if (len(args.weights_sha256)!=64 or
        any(c not in "0123456789abcdef" for c in args.weights_sha256)):
        raise ValueError("actual_installed_weights_sha_required")
    read_public_reference(args.reference)
    result=validate_native_model_mask(args.source,args.mask)
    result.update({
       "schema":"opus-real-second-lung-nodule-public-model/v1",
       "model":"TotalSegmentator",
       "task":"lung_nodules",
       "modelVersion":"2.18.0",
       "observedInstalledCheckpointSha256NotPublisherSigned":args.weights_sha256,
       "trainedWeightsLoadedInSeparateActualInferenceStep":True,
       "labels":{"1":"lung_anatomy_not_pathology","2":"lung_nodules_research"},
       "publicStudy":"LUNA16 selected positive original HU CT",
       "notIndependentHoldoutFromLIDCIDRI":True,
       "limitations":[
          "LUNA16 derives from LIDC-IDRI, which was partly used for the task lung_nodules training; independent holdout not proven.",
          "Only a published expert center and diameter, not 3D segmentation masks, are available on this case.",
          "No statement of negative diagnosis, calibrated confidence, lesion-level FROC or clinical validity.",
          "Checkpoint SHA comes from installed official files, not an independently signed publisher fingerprint."
       ]})
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False))
    print(json.dumps({key:result[key] for key in
       ("schema","task","noduleLabel2VoxelCount","modelLabel2ConnectedComponents",
        "nearestModelNoduleVoxelToPublishedExpertCenterWithin12Mm",
        "modelMaskWithin5MmOfPublishedExpertCenter","clinicalValidation")},ensure_ascii=False))

if __name__=="__main__":main()
