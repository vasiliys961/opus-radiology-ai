"""Synthetic-only four-organ slab tests: no weights, CT dataset or heavy inference."""
import hashlib
import importlib.util
import json
from pathlib import Path
import struct

import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("slab",ROOT/"scripts/extract-totalseg-mpr-slab.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE="b"*64
LABELS=(1,2,3,5)


def source(tmp_path, bad_profile=False, bad_units=False):
    dims=(4,3,5)
    header=bytearray(352)
    struct.pack_into("<i",header,0,348)
    struct.pack_into("<4h",header,40,3,*dims)
    struct.pack_into("<hh",header,70,2,8)
    struct.pack_into("<f",header,108,352.)
    struct.pack_into("<h",header,254,2)
    struct.pack_into("<h",header,252,1)
    header[123]=0 if bad_units else 2
    struct.pack_into("<12f",header,280,-1,0,0,-100,
                     0,-2,0,-200,0,0,3,20)
    header[344:348]=b"n+1\x00"
    pixels=b"".join(bytes([LABELS[z%4]]*12) for z in range(5))
    mask=tmp_path/"source.nii"
    mask.write_bytes(header+pixels)
    report=tmp_path/"model-report.json"
    report.write_text(json.dumps({
        "schema":"opus-totalseg-first-inference/v1",
        "status":"completed_unvalidated","readyForClinicalUse":False,
        "researchProfile":"lung-lobes" if bad_profile else "abdomen-four-organs",
        "sourceSha256":SOURCE,
        "maskSha256":hashlib.sha256(mask.read_bytes()).hexdigest(),
    }))
    return mask,report


def run(tmp_path, bad_profile=False, bad_units=False):
    source_mask,report=source(tmp_path,bad_profile,bad_units)
    result=tmp_path/"slab.nii"
    manifest=tmp_path/"slab.json"
    return module.extract(source_mask,report,result,manifest,1,3,SOURCE,
                          research_profile="abdomen-four-organs"),result,manifest


def test_real_native_indices_and_sha_binding_of_four_organs(tmp_path):
    summary,out,manifest=run(tmp_path)
    contents=out.read_bytes()
    assert summary["schema"]=="opus-totalseg-abdomen-native-mpr-slab/v1"
    assert summary["researchProfile"]=="abdomen-four-organs"
    assert summary["sourceDimensions"]==[4,3,5]
    assert summary["slabDimensions"]==[4,3,3]
    assert summary["firstOriginalSliceIndexZeroBased"]==1
    assert summary["lastOriginalSliceIndexZeroBased"]==3
    assert summary["labelVoxels"]==[{"id":1,"voxels":0},{"id":2,"voxels":12},
                                    {"id":3,"voxels":12},{"id":5,"voxels":12}]
    assert contents[352:]==bytes([2]*12+[3]*12+[5]*12)
    assert struct.unpack_from("<f",contents,324)[0]==23
    assert struct.unpack_from("<h",contents,252)[0]==0
    assert hashlib.sha256(contents).hexdigest()==summary["slabMaskSha256"]
    assert json.loads(manifest.read_text())==summary
    assert summary["readyForClinicalUse"] is False


def test_refuses_cross_profile_lung_reports_without_creating_artifacts(tmp_path):
    m,r=source(tmp_path,bad_profile=True)
    with pytest.raises(ValueError,match="source_or_model_result_unverified"):
        module.extract(m,r,tmp_path/"out.nii",tmp_path/"out.json",0,2,SOURCE,
                       research_profile="abdomen-four-organs")
    assert not (tmp_path/"out.nii").exists()


def test_refuses_unverified_units_and_tampered_mask(tmp_path):
    m,r=source(tmp_path,bad_units=True)
    with pytest.raises(ValueError,match="invalid_native_mask_format"):
        module.extract(m,r,tmp_path/"out.nii",tmp_path/"out.json",0,2,SOURCE,
                       research_profile="abdomen-four-organs")
    # Original hash is pinned in report. Changing pixels must fail before output.
    m,r=source(tmp_path)
    m.write_bytes(m.read_bytes()[:-1]+b"\x00")
    with pytest.raises(ValueError,match="mask_sha_mismatch"):
        module.extract(m,r,tmp_path/"out.nii",tmp_path/"out.json",0,2,SOURCE,
                       research_profile="abdomen-four-organs")


def test_original_profile_and_browser_memory_bounds_stay_enforced(tmp_path):
    m,r=source(tmp_path)
    with pytest.raises(ValueError,match="source_or_model_result_unverified"):
        module.extract(m,r,tmp_path/"out.nii",tmp_path/"out.json",0,2,SOURCE)
    with pytest.raises(ValueError,match="slab_exceeds_browser_limits"):
        module.extract(m,r,tmp_path/"out.nii",tmp_path/"out.json",0,8,SOURCE,
                       research_profile="abdomen-four-organs")


def test_workflow_keeps_slab_and_ground_truth_ephemeral():
    workflow=(ROOT/".github/workflows/totalseg-msd-abdomen-public-ct.yml").read_text()
    assert "workflow_dispatch:" in workflow
    assert workflow.index("Score spleen against independent")<workflow.index("Validate bounded 32-frame")
    assert workflow.index("Validate bounded 32-frame")<workflow.index("Remove all public image volumes")
    assert "--research-profile abdomen-four-organs" in workflow
    assert "upload-artifact" not in workflow
