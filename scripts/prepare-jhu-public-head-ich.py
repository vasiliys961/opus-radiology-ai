#!/usr/bin/env python3
"""One genuinely public NCCT JHU DICOM-derived NIfTI → bounded ICH research input.

The published JHU case is publicly downloadable, not an RSNA/Kaggle/PhysioNet
restricted source. Full bytes are verified against the publisher's MD5 before
any archive member is read. We do NOT claim its DICOM RescaleSlope/Intercept
were independently reconstructed from source DICOM: values must additionally
look like CT HU; the model report retains unverified-provenance caution.
No CT pixels, IDs, subject demographics, archive members, or paths are logged.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import shutil
import tarfile
import tempfile
from urllib.request import Request,urlopen

ARCHIVE_URL="https://archive.data.jhu.edu/api/access/datafile/1311?gbrecs=true"
ARCHIVE_MD5="a1e57f5cb684fc238d32a019bec456ad"
PUBLISHER_DOI="10.7281/T1/CZDPSX"
SOURCE_MEMBER="01/BRAIN_1_Anonymized.nii.gz"
MAX_ARCHIVE_BYTES=16*1024**2
MAX_NII_GZIP_BYTES=64*1024**2
MAX_VOLUME_VOXELS=512*512*128
MAX_UNCOMPRESSED_BYTES=128*1024**2

def sha256(source:Path):
    h=hashlib.sha256()
    with source.open("rb") as f:
        for piece in iter(lambda:f.read(1024*1024),b""):
            h.update(piece)
    return h.hexdigest()

def public_archive_download(out:Path)->str:
    if out.exists():
        raise ValueError("archive_output_must_not_exist")
    out.parent.mkdir(parents=True,exist_ok=True)
    digest=hashlib.md5(usedforsecurity=False)
    total=0
    try:
        with urlopen(Request(ARCHIVE_URL,headers={"User-Agent":"OpusRadiologyResearch/1.0"}),
                     timeout=60) as response, out.open("xb") as f:
            if response.url.split("?")[0] != ARCHIVE_URL.split("?")[0]:
                raise ValueError("public_dataset_unexpected_redirect")
            while True:
                block=response.read(1024*1024)
                if not block:break
                total+=len(block)
                if total>MAX_ARCHIVE_BYTES:
                    raise ValueError("public_source_archive_too_large")
                digest.update(block)
                f.write(block)
        if not 1024*1024<total<=MAX_ARCHIVE_BYTES or digest.hexdigest()!=ARCHIVE_MD5:
            raise ValueError("public_source_archive_md5_mismatch")
    except BaseException:
        out.unlink(missing_ok=True)
        raise
    return digest.hexdigest()

def original_nifti_from_archive(archive:Path,out:Path)->str:
    if out.exists() or not archive.is_file():
        raise ValueError("invalid_new_public_input_path")
    if archive.stat().st_size>MAX_ARCHIVE_BYTES:
        raise ValueError("source_archive_exceeds_limit")
    if hashlib.md5(archive.read_bytes(),usedforsecurity=False).hexdigest()!=ARCHIVE_MD5:
        raise ValueError("original_archive_digest_changed")
    # Only extract ONE exact original NIfTI; never extract a remote tar tree.
    with tarfile.open(archive,mode="r:xz") as tar:
        items=[i for i in tar if i.name.lstrip("./")==SOURCE_MEMBER]
        if len(items)!=1 or not items[0].isfile() or not(
            352<=items[0].size<=MAX_NII_GZIP_BYTES):
            raise ValueError("published_original_nifti_not_found")
        stream=tar.extractfile(items[0])
        if stream is None:
            raise ValueError("published_ct_member_unreadable")
        with stream:
            data=stream.read(MAX_NII_GZIP_BYTES+1)
        if len(data)!=items[0].size:
            raise ValueError("published_ct_member_truncated")
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_bytes(data)
    return hashlib.sha256(data).hexdigest()

def convert_publisher_ct_and_manifest(original:Path,dest:Path,evidence:Path):
    """Transcribe ALL original source voxels, never skull-strip or crop any slice."""
    if dest.exists() or evidence.exists() or dest.suffix!=".nii" or evidence.suffix!=".json":
        raise ValueError("research_output_paths_must_be_new")
    if original.stat().st_size>MAX_NII_GZIP_BYTES:
        raise ValueError("original_public_nii_gz_oversized")
    import numpy as np
    import nibabel as nib
    scan=nib.load(str(original))
    dims=scan.shape
    if (len(dims)!=3 or any(v<8 or v>512 for v in dims)
        or int(np.prod(dims))>MAX_VOLUME_VOXELS):
        raise ValueError("public_source_not_a_bounded_full_head_ct")
    arr=np.asarray(scan.dataobj,dtype=np.float32)
    if not np.isfinite(arr).all():
        raise ValueError("invalid_publisher_ct_voxel_values")
    # Constrain the study to plausible original HU; never normalize an image
    # or manufacture HU from a pre-windowed 8-bit image.
    low=float(np.min(arr))
    high=float(np.max(arr))
    if low>=-450 or high<=150 or low<-4096 or high>6000 or high-low<650:
        raise ValueError("publisher_ct_does_not_retain_plausible_hu_scale")
    affine=np.asarray(scan.affine,dtype=float)
    if affine.shape!=(4,4) or not np.isfinite(affine).all():
        raise ValueError("invalid_publisher_ct_affine")
    vec=np.linalg.norm(affine[:3,:3],axis=0)
    direction=affine[:3,:3]/vec
    if (np.any(vec<.1) or np.any(vec>12)
        or not np.allclose(direction.T@direction,np.eye(3),atol=1e-4)
        or np.any(np.max(np.abs(direction),axis=0)<0.999)):
        raise ValueError("unsupported_source_ct_reorientation")
    try:
        dest.parent.mkdir(parents=True,exist_ok=True)
        evidence.parent.mkdir(parents=True,exist_ok=True)
        clean=nib.Nifti1Image(arr,affine)
        clean.set_sform(affine,code=1)
        clean.set_qform(affine,code=0)
        clean.header.set_xyzt_units("mm")
        nib.save(clean,str(dest))
        if dest.stat().st_size>MAX_UNCOMPRESSED_BYTES:
            raise ValueError("publisher_ct_exceeds_worker_memory_gate")
        rec=nib.load(str(dest))
        if not np.array_equal(np.asarray(rec.dataobj),arr) or not np.allclose(rec.affine,affine,atol=1e-4):
            raise ValueError("source_voxels_or_geometry_changed")
        doc={
            "schema":"opus-public-head-ct-hu-evidence/v1",
            "modality":"CT","anatomy":"HEAD","contrast":"NONCONTRAST",
            "publicDataRightsReviewed":True,"deidentifiedPublicDataset":True,
            "sourceUnits":"PUBLISHED_DICOM_DERIVED_CT_HU_LIKE_NOT_DICOM_RESCALE_INDEPENDENTLY_VERIFIED",
            "sourceFullStudy":True,
            "consent":"PUBLIC-HEAD-NCCT-RESEARCH-OK",
            "sourceNiftiSha256":sha256(dest),
            "publisherProvenance":{
                "datasetDoi":PUBLISHER_DOI,
                "publishedArchiveMd5":ARCHIVE_MD5,
                "sourceGzipSha256":sha256(original),
                "intensitiesAreOnlyPlausiblyHU":True,
                "dicomRescaleIndependentlyVerified":False,
                "originalStudyAllSourceSlicesRetained":True,
                "dimensionsXYZ":list(dims),
                "intensityMinimum":round(low,3),
                "intensityMaximum":round(high,3),
                "publicSourceAuditIsNotClinicalValidation":True,
            },
        }
        evidence.write_text(json.dumps(doc,indent=2))
        print(json.dumps({"status":"JHU_PUBLIC_CT_ADMITTED_HU_PLAUSIBLE_NOT_INDEPENDENTLY_VERIFIED",
                          "slicesBounded":True,"clinicalDiagnosisValidated":False,
                          "noImageOrIdentifiersExported":True}))
    except BaseException:
        dest.unlink(missing_ok=True)
        evidence.unlink(missing_ok=True)
        raise
    return doc

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--out-folder",type=Path,required=True)
    args=p.parse_args()
    root=args.out_folder
    if root.exists() and any(root.iterdir()):
        raise ValueError("research_public_workspace_not_empty")
    root.mkdir(parents=True,mode=0o700,exist_ok=True)
    archive=root/"published-01.tar.xz"
    source=root/"published-original-head.nii.gz"
    public_archive_download(archive)
    original_nifti_from_archive(archive,source)
    archive.unlink()
    convert_publisher_ct_and_manifest(source,root/"research-hu-head.nii",
                                      root/"research-hu-evidence.json")
    source.unlink()
if __name__=="__main__":
    main()
