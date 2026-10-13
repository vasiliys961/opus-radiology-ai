#!/usr/bin/env python3
"""Prepare one pinned-case public Medical Segmentation Decathlon spleen CT (no DICOM).
Requires an already downloaded official MONAI MSD Task09_Spleen.tar.
Never interpolates/resamples original CT or its independent spleen annotation.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import tarfile

import nibabel as nib
import numpy as np

ARCHIVE_MD5="410d4a301da4e5b2f6f86ec3ddba524e"
CASE="spleen_2"
MAX_MEMBER=512*1024*1024
MAX_VOXELS=512*512*300

def sha(path,algorithm="sha256"):
    value=hashlib.new(algorithm)
    with Path(path).open("rb") as fd:
        while data:=fd.read(1024*1024):
            value.update(data)
    return value.hexdigest()

def _safe_regular(path):
    if path.is_symlink() or not path.is_file() or not stat.S_ISREG(path.stat().st_mode):
        raise ValueError("unsafe_archive_path")

def _copy_member(archive, member, path):
    if not member.isfile() or not 0<member.size<=MAX_MEMBER:
        raise ValueError("invalid_msd_member")
    fd=archive.extractfile(member)
    if fd is None:
        raise ValueError("invalid_msd_member")
    with path.open("xb") as out:
        left=member.size
        while left:
            data=fd.read(min(left,1024*1024))
            if not data:
                raise ValueError("truncated_msd_member")
            out.write(data)
            left-=len(data)

def _find(archive, folder):
    suffix=f"Task09_Spleen/{folder}/{CASE}.nii.gz"
    found=None
    for member in archive:
        if member.name.removeprefix("./")==suffix:
            if found is not None:
                raise ValueError("duplicate_msd_member")
            found=member
    if found is None:
        raise ValueError("missing_training_reference")
    return found

def prepare(archive_path, destination, expected_md5=ARCHIVE_MD5):
    archive_path=Path(archive_path)
    destination=Path(destination)
    _safe_regular(archive_path)
    if (destination.exists() or destination.is_symlink() or
            not destination.parent.is_dir() or destination.parent.is_symlink()):
        raise ValueError("unsafe_output_destination")
    if sha(archive_path,"md5")!=expected_md5:
        raise ValueError("official_archive_digest_mismatch")
    destination.mkdir(mode=0o700)
    image_gz=destination/"image.nii.gz"
    truth_gz=destination/"spleen_ground_truth.nii.gz"
    raw=destination/"public_abdomen_ct.nii"
    try:
        with tarfile.open(archive_path,"r:") as archive:
            for folder,target in (("imagesTr",image_gz),("labelsTr",truth_gz)):
                entry=_find(archive,folder)
                _copy_member(archive,entry,target)
        image=nib.load(str(image_gz))
        truth=nib.load(str(truth_gz))
        shape=tuple(int(n) for n in image.shape)
        if (len(shape)!=3 or any(not 1<=x<=limit for x,limit in zip(shape,(512,512,300))) or
                math.prod(shape)>MAX_VOXELS or shape!=tuple(truth.shape)):
            raise ValueError("unsupported_public_abdomen_dimensions")
        affine=np.asarray(image.affine,dtype=np.float64)
        if (not np.isfinite(affine).all() or
                not np.isfinite(truth.affine).all() or
                np.max(np.abs(affine-truth.affine))>1e-4):
            raise ValueError("independent_reference_geometry_mismatch")
        data=np.asarray(image.dataobj,dtype=np.float32)
        if (not np.isfinite(data).all() or
                float(np.min(data))<-5000 or float(np.max(data))>20000):
            raise ValueError("invalid_ct_scalar_values")
        gt=np.asanyarray(truth.dataobj)
        if not np.isin(gt,[0,1]).all() or not np.any(gt==1):
            raise ValueError("invalid_spleen_annotation")
        # Original image is an intensity volume, NOT windowed PNG. No spatial transform.
        header=nib.Nifti1Header()
        header.set_data_dtype(np.float32)
        header.set_xyzt_units("mm")
        nib.save(nib.Nifti1Image(data,affine,header=header),str(raw))
        from importlib.util import module_from_spec,spec_from_file_location
        module_path=Path(__file__).resolve().parents[1]/"services/imaging-ai/totalsegmentator_input.py"
        spec=spec_from_file_location("opus_totalseg_input",module_path)
        module=module_from_spec(spec)
        spec.loader.exec_module(module)
        if module.inspect_input(raw)["dimensions"]!=shape:
            raise ValueError("unbound_ct_nifti")
        manifest={
            "schema":"opus-public-msd-spleen-abdomen/v1",
            "collection":"Medical Segmentation Decathlon Task09 Spleen",
            "datasetLicense":"CC BY-SA 4.0 (MSD registry; independently review terms)",
            "sample":CASE,
            "archiveOfficialMd5":expected_md5,
            "archiveSha256":sha(archive_path),
            "inputSha256":sha(raw),
            "referenceSha256":sha(truth_gz),
            "dimensions":list(shape),
            "sourceVoxelSpacingMm":[float(x) for x in image.header.get_zooms()[:3]],
            "referenceLabels":{"0":"background","1":"spleen"},
            "independentReferenceOnlyFor":["spleen"],
            "liverKidneysReferenceAvailable":False,
            "anatomicalCoverageVerified":False,
            "readyForClinicalUse":False,
        }
        (destination/"reference.json").write_text(json.dumps(manifest,sort_keys=True),encoding="utf-8")
        return manifest
    except BaseException:
        for item in destination.iterdir():
            if item.is_file() and not item.is_symlink():
                item.unlink()
        destination.rmdir()
        raise

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--archive",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    a=p.parse_args()
    result=prepare(a.archive,a.output)
    print(json.dumps({"status":"prepared_public_spleen_ct",
      "sample":result["sample"],"dimensions":result["dimensions"],
      "inputSha256":result["inputSha256"],"referenceSha256":result["referenceSha256"],
      "independentReferenceOnlyFor":["spleen"],"clinicalStatus":"not_validated"},sort_keys=True))

if __name__=="__main__":
    main()
