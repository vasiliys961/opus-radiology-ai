#!/usr/bin/env python3
"""Independent public MSD spleen-label Dice against trained TotalSegmentator CT mask.

No ground truth exists here for liver or kidneys. A numeric score is only
reported for the spleen after exact SHA + affine + native-grid matching.
"""
import argparse
import hashlib
import json
import numpy as np
import nibabel as nib
from pathlib import Path

ORGANS=(1,2,3,5)
NAMES={1:"spleen",2:"kidney_right",3:"kidney_left",5:"liver"}

def sha(path):
    d=hashlib.sha256()
    with Path(path).open("rb") as f:
        while chunk:=f.read(131072):
            d.update(chunk)
    return d.hexdigest()

def score(input_folder, mask_file, report_file):
    folder=Path(input_folder)
    mask_file=Path(mask_file)
    report_file=Path(report_file)
    if any(p.is_symlink() for p in (folder,mask_file,report_file)):
        raise ValueError("unsafe_path")
    manifest=json.loads((folder/"reference.json").read_text(encoding="utf-8"))
    report=json.loads(report_file.read_text(encoding="utf-8"))
    source=folder/"public_abdomen_ct.nii"
    truth=folder/"spleen_ground_truth.nii.gz"
    if (manifest.get("schema")!="opus-public-msd-spleen-abdomen/v1" or
            manifest.get("sample")!="spleen_2" or
            manifest.get("independentReferenceOnlyFor")!=["spleen"] or
            manifest.get("liverKidneysReferenceAvailable") is not False or
            report.get("schema")!="opus-totalseg-first-inference/v1" or
            report.get("status")!="completed_unvalidated" or
            report.get("researchProfile")!="abdomen-four-organs" or
            report.get("sourceSha256")!=manifest.get("inputSha256") or
            sha(source)!=manifest["inputSha256"] or
            sha(mask_file)!=report.get("maskSha256") or
            sha(truth)!=manifest.get("referenceSha256")):
        raise ValueError("reference_or_model_binding_mismatch")
    mask=nib.load(str(mask_file))
    gt=nib.load(str(truth))
    img=nib.load(str(source))
    if (len(img.shape)!=3 or mask.shape!=gt.shape or img.shape!=mask.shape):
        raise ValueError("source_grid_mismatch")
    corners=np.array([[x,y,z,1] for x in (0,img.shape[0]-1)
                      for y in (0,img.shape[1]-1)
                      for z in (0,img.shape[2]-1)],dtype=np.float64)
    for affine in (gt.affine,mask.affine):
        if np.max(np.linalg.norm(corners @ (affine-img.affine).T,axis=1))>0.05:
            raise ValueError("source_affine_mismatch")
    prediction=np.asanyarray(mask.dataobj)
    reference=np.asanyarray(gt.dataobj)
    if not np.isin(prediction,[0,*ORGANS]).all() or not np.isin(reference,[0,1]).all():
        raise ValueError("unexpected_mask_values")
    p=prediction==1; t=reference==1
    n_pred=int(np.count_nonzero(p));n_ref=int(np.count_nonzero(t))
    if n_ref==0:
        raise ValueError("empty_independent_reference")
    tp=int(np.count_nonzero(p&t))
    result={
        "schema":"opus-abdomen-msd-spleen-independent-dice/v1",
        "sourceSha256":manifest["inputSha256"],
        "modelMaskSha256":report["maskSha256"],
        "referenceMaskSha256":manifest["referenceSha256"],
        "reference":"MSD Task09 Spleen training annotation (public, independent of TotalSegmentator prediction)",
        "sample":manifest["sample"],
        "dimensions":list(img.shape),
        "spleen":{"labelId":1,"predictedVoxels":n_pred,"referenceVoxels":n_ref,
                  "intersectionVoxels":tp,"dice":round(2*tp/(n_pred+n_ref),6)},
        "otherOrgans":[{"id":i,"name":NAMES[i],"predictedVoxels":int(np.count_nonzero(prediction==i)),
                        "dice":None,"referenceAvailable":False} for i in (2,3,5)],
        "fullAnatomyVerified":False,
        "clinicalStatus":"not_validated",
        "readyForClinicalUse":False,
    }
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--reference",required=True,type=Path)
    p.add_argument("--mask",required=True,type=Path)
    p.add_argument("--report",required=True,type=Path)
    a=p.parse_args()
    print(json.dumps(score(a.reference,a.mask,a.report),sort_keys=True))
if __name__=="__main__":
    main()
