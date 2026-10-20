#!/usr/bin/env python3
"""Source-native hip/femur bone-mask separation in an explicitly selected joint ROI.

This research geometry is NOT a measured radiographic joint-space width and
cannot diagnose coxarthrosis, AVN, hip fracture, labral/chondral disease.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

MAX_BYTES=750*1024**2
MAX_VOXELS=512*512*500


def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for x in iter(lambda:f.read(1024*1024),b""):
            h.update(x)
    return h.hexdigest()


def read_img(path):
    import nibabel as nib
    import numpy as np
    if path.is_symlink() or not path.is_file() or not 120 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("missing_or_unbounded_hip_study")
    m=nib.load(str(path))
    a=m.affine
    if len(m.shape)!=3 or math.prod(m.shape)>MAX_VOXELS or not np.isfinite(a).all():
        raise ValueError("unbounded_or_invalid_native_ct")
    mm=np.linalg.norm(a[:3,:3],axis=0)
    directions=a[:3,:3]/mm
    if (np.any(mm<.2) or np.any(mm>5) or
        abs(np.linalg.det(a[:3,:3]))<.008 or
        not np.allclose(a[3],[0,0,0,1]) or
        max(abs(float(np.dot(directions[:,i],directions[:,j])))
            for i,j in ((0,1),(0,2),(1,2)))>.02):
        raise ValueError("nonorthogonal_or_unsupported_CT_geometry")
    return m,mm


def parse_roi(text,shape):
    groups=text.split(",")
    if len(groups)!=3:
        raise ValueError("roi_must_be_3_native_voxel_ranges")
    sl=[]
    for axis,v in enumerate(groups):
        fields=v.split(":")
        if len(fields)!=2:
            raise ValueError("roi_requires_start_stop")
        try:
            lo,hi=map(int,fields)
        except ValueError as err:
            raise ValueError("invalid_integer_ROI") from err
        if not 0<=lo<hi<=shape[axis] or not 8<=hi-lo<=256:
            raise ValueError("ROI_too_small_or_too_large")
        sl.append(slice(lo,hi))
    return tuple(sl)


def compare(ct_path,hip_path,femur_path,side,roi_spec):
    import numpy as np
    from scipy.ndimage import binary_erosion, distance_transform_edt
    if side not in ("left","right"):
        raise ValueError("invalid_hip_side")
    ct,mm=read_img(ct_path)
    h,_=read_img(hip_path)
    f,_=read_img(femur_path)
    if (ct.shape!=h.shape or ct.shape!=f.shape or
        not np.allclose(h.affine,ct.affine,atol=.02,rtol=0) or
        not np.allclose(f.affine,ct.affine,atol=.02,rtol=0)):
        raise ValueError("hip_femur_original_source_grid_mismatch")
    if h.get_data_dtype().kind not in "biu" or f.get_data_dtype().kind not in "biu":
        raise ValueError("original_anatomical_mask_must_be_integer")
    sl=parse_roi(roi_spec,ct.shape)
    hb=np.asarray(h.dataobj[sl])
    fb=np.asarray(f.dataobj[sl])
    if not np.isin(hb,(0,1)).all() or not np.isin(fb,(0,1)).all():
        raise ValueError("nonbinary_original_anatomical_label")
    hip=hb.astype(bool)
    femur=fb.astype(bool)
    if hip.sum()<300 or femur.sum()<300:
        raise ValueError("joint_ROI_has_insufficient_bone")
    if np.any(hip&femur):
        raise ValueError("hip_femur_masks_overlap_in_source_grid")
    # The surface distance transform is meaningful ONLY inside a clinician
    # chosen proximal-femur/acetabulum joint region with both true anatomy.
    femur_surface=femur & ~binary_erosion(femur)
    distances=distance_transform_edt(~hip,sampling=mm)[femur_surface]
    near=distances[(distances>0)&(distances<=20)]
    if near.size<30:
        raise ValueError("no_anatomical_opposition_within_20mm")
    low=np.array([s.start for s in sl])
    upper=np.array([s.stop-1 for s in sl])
    world=ct.affine @ np.r_[(low+upper)/2.,1.]
    return {
        "schema":"opus-hip-proximal-femur-pelvis-source-mask-separation/v1",
        "sourceCTSHA256":digest(ct_path),
        "femurMaskSHA256":digest(femur_path),
        "hipBoneMaskSHA256":digest(hip_path),
        "anatomyNames":["femur_"+side,"hip_"+side],
        "jointSide":side,"clinicianSelectedOriginalSourceVoxelROIInclusive":
            [low.tolist(),upper.tolist()],
        "researchROICentroidRasMm":[round(float(x),3) for x in world[:3]],
        "nearestFemoralSurfaceSampleCount":int(near.size),
        "distanceToPelvicBoneMaskMm":{
            "min":round(float(np.min(near)),3),
            "p10":round(float(np.percentile(near,10)),3),
            "median":round(float(np.median(near)),3),
            "p90":round(float(np.percentile(near,90)),3)},
        "NOTAnArticularCartilageOrClinicalJointSpaceWidth":True,
        "twoAnatomicalMasksNotJointPathologyDetector":True,
        "sourceROIClipMayAffectGeometry":True,
        "coxarthrosisDiagnosis":None,"osteonecrosisDiagnosis":None,
        "femoroacetabularImpingementDiagnosis":None,
        "fractureDiagnosis":None,
        "genuineModelForwardByThisTool":False,
        "clinicallyValidated":False,"patientCloudTransfer":False}


def main():
    p=argparse.ArgumentParser()
    for name in ("ct","hip-mask","femur-mask","output"):
        p.add_argument("--"+name,type=Path,required=True)
    p.add_argument("--side",choices=("left","right"),required=True)
    p.add_argument("--roi",required=True,help="Native voxel bounds x0:x1,y0:y1,z0:z1")
    p.add_argument("--ct-sha256",required=True)
    p.add_argument("--hip-mask-sha256",required=True)
    p.add_argument("--femur-mask-sha256",required=True)
    p.add_argument("--public-source-url",required=True)
    p.add_argument("--public-source-license",required=True)
    p.add_argument("--approved-public-research",action="store_true")
    a=p.parse_args()
    if (not a.approved_public_research or not a.public_source_url.startswith("https://")
            or not a.public_source_license.strip()):
        p.error("licensed_public_deidentified_CT_required")
    for path,expected in ((a.ct,a.ct_sha256),(a.hip_mask,a.hip_mask_sha256),
                          (a.femur_mask,a.femur_mask_sha256)):
        if len(expected)!=64 or digest(path)!=expected.lower():
            p.error("source_or_original_anatomy_SHA256_mismatch")
    result=compare(a.ct,a.hip_mask,a.femur_mask,a.side,a.roi)
    result["publicSourceURL"]=a.public_source_url
    result["verifiedOriginalSourceLicenseClaim"]=a.public_source_license
    if a.output.exists() or a.output.is_symlink():
        p.error("new_report_destination_required")
    a.output.parent.mkdir(exist_ok=True,parents=True)
    a.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"side":a.side,"sampleCount":result["nearestFemoralSurfaceSampleCount"],
                      "clinicalJointSpaceWidth":None,"clinicallyValidated":False}))


if __name__=="__main__":
    main()
