#!/usr/bin/env python3
"""Reproduce real MONAI source-bound inference on a pinned PUBLIC LUNA16 CT.

Prepare: original pinned MetaImage RAW (not windowed JPEG) -> NIfTI-1 HU with
unchanged voxel bytes and exact LPS<->RAS world affine; build source admission.
Verify: actual new pretrained report -> SHA and source-centroid match.
No patient scans, identifiers, image bytes or checkpoints are committed.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import shutil
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
SPEC=importlib.util.spec_from_file_location("luna16_download",ROOT/"scripts/prepare-luna16-single-gpu-case.py")
prep=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(prep)
sys.path.insert(0,str(ROOT/"services/imaging-ai"))
from nodule_source_geometry import geometry_from_mhd
from monai_bound_nodule import original_nifti

KNOWN_SOURCE_RAW="ca3c712205e3e8a2d9f5cbc19615a7b47c757ccf2a6b5b9b6a4e15ec0d70afc5"
KNOWN_LPS_CENTER=(-64.11833,-4.88744,-85.90245)

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda:f.read(1048576),b""):
            h.update(block)
    return h.hexdigest()

def prepare(case_dir,output_dir):
    case_dir=Path(case_dir).resolve()
    destination=Path(output_dir).resolve()
    if destination.exists():
        raise ValueError("nonempty_or_existing_test_workdir")
    manifest=json.loads((case_dir/"verified-case.json").read_text())
    if (manifest.get("schema")!="opus-monai-public-gpu-case/v1" or
            manifest.get("downloadVerified") is not True or
            manifest.get("positiveExpertReferenceNodules")!=1):
        raise ValueError("pinned_public_case_reference_required")
    entries={}
    for item in manifest["files"]:
        rel=Path(item["relativePath"])
        if (rel.is_absolute() or len(rel.parts)!=2 or rel.parts[0]!="subset0" or
                rel.suffix not in (".mhd",".raw")):
            raise ValueError("nonallowlisted_public_source")
        candidate=(case_dir/rel).resolve()
        if not candidate.is_relative_to(case_dir) or not candidate.is_file():
            raise ValueError("no_approved_public_source")
        if candidate.stat().st_size!=item["sizeBytes"] or digest(candidate)!=item["actualSha256"]:
            raise ValueError("pinned_original_file_sha_failed")
        entries[rel.suffix]=candidate
    if len(entries)!=2 or digest(entries[".raw"])!=KNOWN_SOURCE_RAW:
        raise ValueError("different_or_unverified_luna16_source")
    text=entries[".mhd"].read_text("ascii")
    validated=prep.validate_mhd(entries[".mhd"],entries[".raw"])
    geometry=geometry_from_mhd(text)
    dims=geometry["dimensions"]
    if list(dims)!=validated["dimensions"] or list(dims)!=[512,512,109]:
        raise ValueError("unexpected_original_luna16_voxel_shape")
    if entries[".raw"].stat().st_size!=math.prod(dims)*2:
        raise ValueError("non_native_raw_size")
    matrix=geometry["directionMatrix"]
    spacing=geometry["spacingMm"]
    origin=geometry["origin"]
    destination.mkdir(mode=0o700,parents=False)
    source=destination/"original-source.nii"
    header=bytearray(352)
    struct.pack_into("<i",header,0,348)
    struct.pack_into("<h",header,40,3)
    struct.pack_into("<7h",header,42,*dims,1,1,1,1)
    struct.pack_into("<h",header,70,4)   # original little-endian int16 HU
    struct.pack_into("<h",header,72,16)
    struct.pack_into("<f",header,108,352)
    struct.pack_into("<f",header,112,1)
    struct.pack_into("<f",header,116,0)
    header[123]=2                 # spatial units: millimeters
    struct.pack_into("<h",header,254,1) # scanner sform
    for row in range(3):
        ras_sign=-1 if row<2 else 1
        coords=[ras_sign*matrix[row][col]*spacing[col] for col in range(3)]
        coords.append(ras_sign*origin[row])
        struct.pack_into("<4f",header,280+16*row,*coords)
    header[344:348]=b"n+1\x00"
    with source.open("xb") as out,entries[".raw"].open("rb") as raw:
        out.write(header)
        shutil.copyfileobj(raw,out,1048576)
    validated=original_nifti(source)
    for row in range(3):
        for col in range(3):
            want=matrix[row][col]*spacing[col]
            observed=validated["affineLps"][row*4+col]
            if abs(want-observed)>0.0001:
                raise ValueError("source_lps_affine_conversion_failed")
        if abs(validated["affineLps"][row*4+3]-origin[row])>0.0001:
            raise ValueError("source_lps_origin_conversion_failed")
    attestation={
      "schema":"opus-public-chest-nodule-admission/v1",
      "sourceNiftiSha256":validated["sourceSha256"],"modality":"CT",
      "anatomy":"CHEST","intensity":"original-HU",
      "publicOrRightsClearedData":True,"containsPatientData":False,
      "fullSelectedSeriesPresent":True
    }
    (destination/"source-admission.json").write_text(json.dumps(attestation))
    print(json.dumps({"result":"public_native_source_prepared","sourceSha256":validated["sourceSha256"],
       "nativeDimensions":dims,"originalHUBytesUnchanged":True,
       "sourceGeometryPassed":True,"originalRawSha256":KNOWN_SOURCE_RAW}))

def verify(report_path,source_dir):
    report=json.loads(Path(report_path).read_text())
    input_image=Path(source_dir)/"original-source.nii"
    source=original_nifti(input_image)
    assert report["schema"]=="opus-monai-bound-nodule-inference/v1"
    assert report["source"]["sha256"]==source["sourceSha256"]
    assert report["source"]["dimensions"]==source["dimensions"]
    assert report["model"]["pretrainedCheckpointReadFromVerifiedBundle"] is True
    assert report["execution"]["actualPretrainedInferenceCompleted"] is True
    assert report["execution"]["modelCalledOnThisExactSource"] is True
    assert report["clinicallyValidated"] is False
    verified=[]
    for candidate in report["candidates"]:
        p=candidate["centerLpsMm"]
        distance=math.dist(p,KNOWN_LPS_CENTER)
        if candidate["score"]>=0.5 and distance<=5:
            verified.append((candidate["index"],candidate["score"],distance))
    if not verified:
        raise ValueError("NO_PUBLIC_LUNA16_CANDIDATE_CLOSE_TO_PUBLISHED_REFERENCE")
    print(json.dumps({"result":"REAL_PRETRAINED_MONAI_ON_SOURCE_BOUND_PUBLIC_CT",
      "sourceSha256":source["sourceSha256"],
      "trueModelCandidateCount":len(report["candidates"]),
      "publishedReferenceCenterHitWithin5MmAtScore0_5":True,
      "bestCandidateIndex":min(verified,key=lambda x:x[2])[0],
      "nearestCenterDistanceMm":round(min(x[2] for x in verified),3),
      "modelInferenceCompleted":True,"independentHeldOutSensitivity":None,
      "clinicallyValidated":False},ensure_ascii=False))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--prepare",action="store_true")
    p.add_argument("--verify",action="store_true")
    p.add_argument("--case-dir",type=Path)
    p.add_argument("--out-dir",required=True,type=Path)
    p.add_argument("--report",type=Path)
    a=p.parse_args()
    if a.prepare==a.verify:
        raise ValueError("select_one_mode")
    if a.prepare:prepare(a.case_dir,a.out_dir)
    else:verify(a.report,a.out_dir)

if __name__=="__main__":main()
