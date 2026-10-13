"""Synthetic *geometry and binding* tests. Does not claim real model acceptance."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("slab",ROOT/"scripts/extract-totalseg-mpr-slab.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
SOURCE="a"*64


def source(tmp_path, dims=(4,3,5), bad_units=False):
    h=bytearray(352)
    struct.pack_into("<i",h,0,348)
    struct.pack_into("<4h",h,40,3,*dims)
    struct.pack_into("<hh",h,70,2,8)
    struct.pack_into("<f",h,108,352.)
    struct.pack_into("<h",h,254,2)
    struct.pack_into("<h",h,252,1)
    h[123]=0 if bad_units else 2
    struct.pack_into("<12f",h,280,1,0,0,-100,
                     0,1,0,-200,0,0,3,20)
    h[344:348]=b"n+1\x00"
    # Three-dimensional z-slices preserve unique contiguous voxel labels.
    pixels=b"".join(bytes([10+(i%5)]*dims[0]*dims[1]) for i in range(dims[2]))
    src=tmp_path/"full.nii"
    src.write_bytes(h+pixels)
    report=tmp_path/"report.json"
    report.write_text(json.dumps({
        "schema":"opus-totalseg-first-inference/v1",
        "status":"completed_unvalidated",
        "readyForClinicalUse":False,
        "sourceSha256":SOURCE,
        "maskSha256":hashlib.sha256(src.read_bytes()).hexdigest()}))
    return src,report


def test_exact_slab_geometry_and_native_voxels(tmp_path):
    src,report=source(tmp_path)
    out=tmp_path/"slab.nii"
    meta=tmp_path/"slab.json"
    result=mod.extract(src,report,out,meta,1,3,SOURCE)
    payload=out.read_bytes()
    assert len(payload)==352+4*3*3
    assert struct.unpack_from("<4h",payload,40)==(3,4,3,3)
    assert payload[352:]==bytes([11]*12+[12]*12+[13]*12)
    assert struct.unpack_from("<f",payload,324)[0]==23
    assert struct.unpack_from("<h",payload,252)[0]==0
    assert struct.unpack_from("<h",payload,254)[0]==2
    assert result["firstOriginalSliceIndexZeroBased"]==1
    assert result["slabMaskSha256"]==hashlib.sha256(payload).hexdigest()
    assert result["labelVoxels"][1]["voxels"]==12
    assert not result["readyForClinicalUse"]


def test_reject_mask_tamper_and_do_not_create_result(tmp_path):
    src,report=source(tmp_path)
    src.write_bytes(src.read_bytes()[:-1]+b"\xff")
    with pytest.raises(ValueError,match="mask_sha_mismatch"):
        mod.extract(src,report,tmp_path/"slab.nii",tmp_path/"slab.json",0,2,SOURCE)
    assert not (tmp_path/"slab.nii").exists()


def test_reject_wrong_source_binding(tmp_path):
    src,report=source(tmp_path)
    with pytest.raises(ValueError,match="source_or_model_result_unverified"):
        mod.extract(src,report,tmp_path/"slab.nii",tmp_path/"slab.json",0,2,"b"*64)


def test_reject_voxel_budget(tmp_path):
    src,report=source(tmp_path)
    with pytest.raises(ValueError,match="slab_exceeds_browser_limits"):
        mod.extract(src,report,tmp_path/"slab.nii",tmp_path/"slab.json",1,5,SOURCE)


def test_unknown_units_rejected_before_browser_import(tmp_path):
    src,report=source(tmp_path,bad_units=True)
    with pytest.raises(ValueError,match="invalid_native_mask_format"):
        mod.extract(src,report,tmp_path/"slab.nii",tmp_path/"slab.json",0,2,SOURCE)


def test_reject_same_existing_output_and_manifest(tmp_path):
    src,report=source(tmp_path)
    out=tmp_path/"slab.nii"
    out.write_bytes(b"existing")
    with pytest.raises(ValueError,match="invalid_paths"):
        mod.extract(src,report,out,tmp_path/"slab.json",0,2,SOURCE)
    assert out.read_bytes()==b"existing"
