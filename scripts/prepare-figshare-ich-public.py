#!/usr/bin/env python3
"""Admit ONE publicly licensed genuine NCCT volume without downloading 1.3 GiB.

Read only bounded HTTP 206 ranges of the indexed Figshare PHE-SICH-CT-IDS ZIP.
Read original .nii.gz CT + original edema-reference NIfTI (if matching), never
JPEG/PNG windows. Research-only: source NIfTI might not preserve original HU;
reject it if apparent CT HU are missing. Never report edema as a bleed mask.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
from pathlib import Path
import re
import struct
from urllib.request import Request,urlopen
import zlib

ARTICLE="https://api.figshare.com/v2/articles/23957937"
DOWNLOAD="https://ndownloader.figshare.com/files/63081925"
LICENSE="CC BY 4.0"
FILE_ID=63081925
ZIP_SIZE=1300209108
PUBLISHER_MD5="a2c3f32f11478167b975d5036edbb510"
MAX_CENTRAL=4*1024*1024
MAX_NIFTI_GZ=32*1024*1024
MAX_VOLUME_BYTES=256*1024*1024
MAX_VOXELS=512*512*128


def sha256(path:Path):
    h=hashlib.sha256()
    with path.open("rb") as s:
        for chunk in iter(lambda:s.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()


def _metadata():
    with urlopen(Request(ARTICLE,headers={"Accept":"application/json",
                 "User-Agent":"OpusRadiologyResearch/1"}),timeout=30) as response:
        data=json.load(response)
    files=data.get("files")
    if (data.get("id")!=23957937 or
        data.get("license",{}).get("name")!=LICENSE or
        not isinstance(files,list) or len(files)!=1 or
        files[0].get("id")!=FILE_ID or files[0].get("size")!=ZIP_SIZE or
        files[0].get("computed_md5")!=PUBLISHER_MD5 or
        files[0].get("download_url")!=DOWNLOAD or
        files[0].get("is_link_only") is not False):
        raise ValueError("public_original_figshare_source_license_or_digest_changed")
    return data


def _remote(start:int,end:int)->bytes:
    if not (isinstance(start,int) and isinstance(end,int) and
            0<=start<=end<ZIP_SIZE and end-start+1<=MAX_NIFTI_GZ):
        raise ValueError("remote_public_source_range_out_of_bounds")
    request=Request(DOWNLOAD,headers={"User-Agent":"OpusRadiologyResearch/1",
                   "Range":f"bytes={start}-{end}"})
    with urlopen(request,timeout=65) as response:
        expected=f"bytes {start}-{end}/{ZIP_SIZE}"
        if response.status!=206 or response.headers.get("Content-Range")!=expected:
            raise ValueError("figshare_range_not_verified")
        block=response.read(end-start+2)
    if len(block)!=end-start+1:
        raise ValueError("figshare_ranged_content_incomplete")
    return block


def _zip_index():
    """Central index of the publisher ZIP, no extraction or pixel download."""
    tail=_remote(ZIP_SIZE-65536,ZIP_SIZE-1)
    end=tail.rfind(b"PK\x05\x06")
    if end<0 or end+22>len(tail):
        raise ValueError("published_zip_end_missing")
    (_,disk,cd_disk,count_disk,total,central_size,central_offset,comment)=struct.unpack_from(
       "<4s4H2LH",tail,end)
    if (disk or cd_disk or total!=count_disk or not 240<=total<=25000
        or not 46<=central_size<=MAX_CENTRAL or
        central_offset+central_size>ZIP_SIZE):
        raise ValueError("unsupported_public_zip_index")
    directory=_remote(central_offset,central_offset+central_size-1)
    entries=[]
    pos=0
    for _ in range(total):
        if pos+46>len(directory):
            raise ValueError("truncated_public_zip_index")
        h=struct.unpack_from("<4s6H3L5H2L",directory,pos)
        if h[0]!=b"PK\x01\x02":
            raise ValueError("invalid_public_zip_central_record")
        flags,method,crc,compressed,uncompressed=h[3],h[4],h[7],h[8],h[9]
        nlen,elen,clen=h[10:13]
        local=h[16]
        name_bytes=directory[pos+46:pos+46+nlen]
        if len(name_bytes)!=nlen or pos+46+nlen+elen+clen>len(directory):
            raise ValueError("invalid_public_zip_member_name")
        try:name=name_bytes.decode("utf-8")
        except UnicodeDecodeError:raise ValueError("non_utf8_public_zip_name")
        if (".." in name.split("/") or name.startswith("/")
            or "\\" in name or len(name)>256 or local>=central_offset):
            raise ValueError("unsafe_public_zip_member_path")
        entries.append({"name":name,"flag":flags,"method":method,
                        "crc":crc,"compressed":compressed,"uncompressed":uncompressed,
                        "local":local})
        pos+=46+nlen+elen+clen
    if pos!=len(directory):
        raise ValueError("public_zip_index_trailing_bytes")
    return entries


def _read_member(e:dict):
    length=e["compressed"]
    if (e["method"]!=0 or e["flag"]&1 or
        not 352<=length<=MAX_NIFTI_GZ or
        e["uncompressed"]!=length):
        raise ValueError("public_source_not_safe_stored_nifti")
    header=_remote(e["local"],e["local"]+29)
    (signature,version,flags,method,mtime,mdate,crc,compressed,uncompressed,
     nlen,xlen)=struct.unpack("<4s5H3L2H",header)
    if signature!=b"PK\x03\x04" or method!=0 or flags&1:
        raise ValueError("unsafe_zip_local_header")
    name_bytes=_remote(e["local"]+30,e["local"]+30+nlen-1)
    if name_bytes.decode("utf-8")!=e["name"]:
        raise ValueError("zip_central_and_local_member_identity_mismatch")
    start=e["local"]+30+nlen+xlen
    payload=_remote(start,start+length-1)
    if zlib.crc32(payload)!=e["crc"]:
        raise ValueError("public_zip_member_crc_mismatch")
    return payload


def _admit_one(source:Path,work:Path,index:int,volume_digest:str)->dict:
    import nibabel as nib
    import numpy as np
    scan=nib.load(str(source))
    dims=scan.shape
    if (len(dims)!=3 or any(not 8<=int(x)<=512 for x in dims)
        or math.prod(dims)>MAX_VOXELS):
        raise ValueError("published_ct_dimensions_not_supported")
    image=np.asarray(scan.dataobj,dtype=np.float32)
    if not np.isfinite(image).all():
        raise ValueError("public_ct_nonfinite_pixels")
    low=float(image.min())
    high=float(image.max())
    if low>=-450 or high<=150 or low<-4096 or high>6000 or high-low<650:
        raise ValueError("published_ct_missing_native_hu_like_intensities")
    affine=np.asarray(scan.affine,dtype=float)
    if not np.isfinite(affine).all():
        raise ValueError("public_ct_affine_invalid")
    lengths=np.linalg.norm(affine[:3,:3],axis=0)
    if np.any(lengths<.1) or np.any(lengths>12):
        raise ValueError("public_ct_pixel_spacing_invalid")
    axes=affine[:3,:3]/lengths
    if (not np.allclose(axes.T@axes,np.eye(3),atol=1e-4) or
       np.any(np.max(np.abs(axes),axis=0)<0.999)):
        raise ValueError("public_source_oblique_requires_registration")
    target=work/"public-original-head-ct-hu-like.nii"
    if target.exists():raise ValueError("output_should_be_new")
    validated=nib.Nifti1Image(image,affine)
    validated.set_sform(affine,code=1)
    validated.set_qform(affine,code=0)
    validated.header.set_xyzt_units("mm")
    nib.save(validated,str(target))
    if target.stat().st_size>MAX_VOLUME_BYTES:
        target.unlink()
        raise ValueError("source_volume_out_of_bounds")
    reloaded=nib.load(str(target))
    if not np.array_equal(np.asarray(reloaded.dataobj),image) or not np.allclose(reloaded.affine,affine,atol=1e-4):
        target.unlink()
        raise ValueError("failed_to_preserve_original_volume")
    return {"sourceNiftiSha256":sha256(target),"sourceGzipSha256":volume_digest,
            "dims":list(dims),"min":round(low,2),"max":round(high,2),
            "sourceArchiveNiftiOrdinal":index}


def run(out:Path):
    if out.exists() and any(out.iterdir()):
        raise ValueError("public_workspace_must_be_empty")
    out.mkdir(parents=True,mode=0o700,exist_ok=True)
    _metadata()
    entries=_zip_index()
    source_candidates=[
      e for e in entries if
      "SubdatasetA_NIFIT" in e["name"] and e["name"].endswith(".nii.gz")
      and 2*1024*1024<e["compressed"]<MAX_NIFTI_GZ
      and e["uncompressed"]==e["compressed"] and e["method"]==0
    ]
    if not source_candidates:
        raise ValueError("no_full_original_public_ncct_nifti_in_archive")
    source_candidates.sort(key=lambda e:(e["compressed"],e["name"]))
    errors=[]
    for index,e in enumerate(source_candidates[:8]):
        source=out/"bounded-published-candidate.nii.gz"
        try:
            blob=_read_member(e)
            source.write_bytes(blob)
            digest=hashlib.sha256(blob).hexdigest()
            tested=_admit_one(source,out,index,digest)
            doc={
              "schema":"opus-public-head-ct-hu-evidence/v1",
              "modality":"CT","anatomy":"HEAD","contrast":"NONCONTRAST",
              "publicDataRightsReviewed":True,"deidentifiedPublicDataset":True,
              "sourceUnits":"PUBLISHED_FIGSHARE_NONCONTRAST_CT_HU_LIKE_NOT_INDEPENDENTLY_VERIFIED",
              "sourceFullStudy":True,
              "consent":"PUBLIC-HEAD-NCCT-RESEARCH-OK",
              "sourceNiftiSha256":tested["sourceNiftiSha256"],
              "publisherProvenance":{
                "repository":"Figshare",
                "articleId":23957937,
                "license":"CC BY 4.0",
                "fileId":FILE_ID,
                "publishedArchiveSize":ZIP_SIZE,
                "publishedArchiveMd5MetadataOnlyNotRecomputed":PUBLISHER_MD5,
                "originalMemberCRC32Checked":True,
                "originalGzipSha256":tested["sourceGzipSha256"],
                "huFromOriginalDicomRescaleIndependentlyVerified":False,
                "originalFullVolumePreserved":True,
                "intensityUnitsOnlyPlausibleHU":True,
                "fullVolumeDimensions":tested["dims"],
                "minIntensity":tested["min"],
                "maxIntensity":tested["max"],
                "positiveHemorrhageStudyPerPublishedCohortNotIndependentlyDiagnosed":True,
                "referenceLabelsArePerihematomalEdemaNotHemorrhage":True,
                "expertHematomaMaskCompared":False,
                "modelLesionDetectionProven":False
              }
            }
            (out/"public-source-evidence.json").write_text(json.dumps(doc,indent=2))
            print(json.dumps({"status":"verified_public_archive_member_hu_like_ct",
                              "sizeClass":"one_source_scan","dimensions":tested["dims"],
                              "intensityMin":tested["min"],"intensityMax":tested["max"],
                              "huFromDicomVerified":False,"modelInferencePerformed":False,
                              "sourceRights":"CC BY 4.0","patientIdentifiersIncluded":False}))
            return doc
        except (ValueError,OSError,EOFError,MemoryError) as exc:
            errors.append(type(exc).__name__)
            (out/"public-original-head-ct-hu-like.nii").unlink(missing_ok=True)
        finally:
            source.unlink(missing_ok=True)
    raise ValueError("no_admissible_true_original_ncct_from_first_8_public_nifti_cases")


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--out-folder",type=Path,required=True)
    args=p.parse_args()
    run(args.out_folder)

if __name__=="__main__":main()
