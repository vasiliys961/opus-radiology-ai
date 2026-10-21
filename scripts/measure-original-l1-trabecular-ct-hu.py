#!/usr/bin/env python3
"""Source-grid CT trabecular L1 ROI HU research tool, no osteoporosis diagnosis.

Accepts a physician-reviewed 3-D ROI binary mask deliberately confined to
trabecular L1 vertebral body, NOT cortical bone, fracture, metal, or disc.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np

def digest(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def measure(ct_path,roi_path):
    import nibabel as nib
    for path in (ct_path,roi_path):
        if (path.is_symlink() or not path.is_file() or
                not 100<path.stat().st_size<750*1024**2):
            raise ValueError("original_bounded_NIfTI_required")
    ct=nib.load(str(ct_path))
    mask=nib.load(str(roi_path))
    if (ct.ndim!=3 or mask.ndim!=3 or
        ct.shape!=mask.shape or np.prod(ct.shape)>512*512*550 or
        not np.allclose(ct.affine,mask.affine,atol=1e-3,rtol=0) or
        not np.isfinite(ct.affine).all() or
        abs(np.linalg.det(ct.affine[:3,:3]))<1e-5):
        raise ValueError("source_native_CT_and_physician_ROI_geometry_required")
    if (mask.get_data_dtype().kind not in "biu" or
        ct.get_data_dtype().kind not in "fi"):
        raise ValueError("HU_float_CT_and_binary_expert_ROI_required")
    valid=[]
    ijks=[]
    # Slice-wise: avoid loading an entire high-resolution scan into RAM.
    for z in range(ct.shape[2]):
        region=np.asarray(mask.dataobj[:,:,z])
        if not np.isin(region,(0,1)).all():raise ValueError("ROI_must_be_binary")
        if not np.any(region):continue
        values=np.asarray(ct.dataobj[:,:,z])[region==1]
        if not np.isfinite(values).all():raise ValueError("nonfinite_source_CT_HU")
        valid.extend(float(v) for v in values)
        where=np.argwhere(region==1)
        ijks.extend((int(i),int(j),z) for i,j in where)
        if len(valid)>200000:raise ValueError("ROI_unreasonably_large")
    if not 100<=len(valid)<=200000:
        raise ValueError("insufficient_expert_trabecular_ROI")
    values=np.asarray(valid,dtype=np.float64)
    if np.min(values)<-1000 or np.max(values)>3500:
        raise ValueError("CT_HU_outside_plausible_range")
    idx=np.asarray(ijks,dtype=np.float64)
    center=idx.mean(axis=0)
    world=(ct.affine@np.r_[center,1])[:3]
    return {
        "schema":"opus-l1-trabecular-original-ct-hu/v1",
        "anatomy":"L1 vertebral body, expert-selected trabecular ROI",
        "sourceCTSha256":digest(ct_path),
        "expertROIHashSha256":digest(roi_path),
        "sourceRASCentroidMm":[round(float(v),3) for v in world],
        "nativeVoxelCentroidIJK":[round(float(v),3) for v in center],
        "roiVoxelCount":int(len(values)),
        "roiVolumeMl":round(float(len(values)*abs(np.linalg.det(ct.affine[:3,:3]))/1000),4),
        "roiHU":{"mean":round(float(np.mean(values)),2),
                 "median":round(float(np.median(values)),2),
                 "p10":round(float(np.percentile(values,10)),2),
                 "p90":round(float(np.percentile(values,90)),2)},
        "contrastAndCalibrationNotEstablished":True,
        "physicianVerifiedL1LocalizationNotEstablishedByThisTool":True,
        "opportunisticAttenuationNotQCTBMD":True,
        "osteoporosisDiagnosis":None,"fractureDiagnosis":None,
        "independentClinicalValidation":False,"cloudUpload":False}
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct",type=Path,required=True)
    p.add_argument("--l1-trabecular-roi",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    if a.output.exists() or a.output.is_symlink():raise ValueError("new_report_destination_required")
    result=measure(a.ct,a.l1_trabecular_roi)
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result,ensure_ascii=False))
if __name__=="__main__":main()
