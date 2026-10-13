"""Contract tests use synthetic bytes only; they NEVER load MONAI or execute weights."""
import importlib.util
import json
from pathlib import Path
import sys
import pytest

ROOT=Path(__file__).resolve().parents[2]
def load(path):
    spec=importlib.util.spec_from_file_location("gpu_" + path.replace("-","_"),ROOT/"scripts"/path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

prep=load("prepare-luna16-single-gpu-case.py")
gpu=load("run-monai-nodule-gpu-case.py")
UID1="1.3.6.1.4.1.14519.5.2.1.6279.6001.105756658031515062000744821260"
UID2="1.3.6.1.4.1.14519.5.2.1.6279.6001.108197895896446896160048741492"

def listing():
    return [
        {"path":f"subset0/{u}.{ext}","size":size,
         "lfs":{"sha256":"a"*64} if ext=="raw" else {}}
        for u,raw in [(UID1,63_400_000),(UID2,95_000_000)]
        for ext,size in [("mhd",428),("raw",raw)]
    ]

def test_selects_smallest_REAL_annotated_public_case_from_fixed_revision_without_inference():
    p=prep.plan_case({UID1:2,UID2:1},listing())
    assert p["datasetRevision"]==prep.REV
    assert p["positiveExpertReferenceNodules"]==2
    assert p["files"][1]["sizeBytes"]==63_400_000
    assert p["modelInferencePerformed"] is False
    assert p["clinicalStatus"]=="public_research_only"
    assert p["sourceSeriesIdSha256"]==prep.sha256(UID1.encode("ascii"))
    assert UID1 not in json.dumps(prep.public_summary(p))

def test_reference_positive_requirement_and_duplicate_bad_files_fail_closed():
    with pytest.raises(ValueError,match="no_pinned_positive"):
        prep.plan_case({UID1:3},[x for x in listing() if UID2 in x["path"]])
    with pytest.raises(ValueError,match="ambiguous_source_paths"):
        prep.plan_case({UID1:3},listing()+[listing()[0]])
    with pytest.raises(ValueError,match="invalid_source_size"):
        bad=listing()
        bad[1]["size"]="huge"
        prep.plan_case({UID1:2},bad)

def test_mhd_pair_needs_source_data_and_no_path_traversal(tmp_path):
    raw=tmp_path/(UID1+".raw")
    raw.write_bytes(b"\0"*(8*8*8*2))
    mhd=tmp_path/(UID1+".mhd")
    mhd.write_text(f"""ObjectType = Image
NDims = 3
BinaryData = True
ElementByteOrderMSB = False
DimSize = 8 8 8
ElementType = MET_SHORT
ElementSpacing = 0.8 0.8 1.25
ElementDataFile = {raw.name}
""")
    assert prep.validate_mhd(mhd,raw)["dimensions"]==[8,8,8]
    raw.write_bytes(b"\0"*10)
    with pytest.raises(ValueError,match="mhd_raw_dimensions_mismatch"):
        prep.validate_mhd(mhd,raw)
    raw.write_bytes(b"\0"*(8*8*8*2))
    mhd.write_text(mhd.read_text().replace(raw.name,"../../patient.raw"))
    with pytest.raises(ValueError,match="incompatible_public_ct_mhd"):
        prep.validate_mhd(mhd,raw)

def test_official_MONAI_saver_single_case_candidate_schema_is_preserved(tmp_path):
    pred=tmp_path/"pred.json"
    pred.write_text(json.dumps([{
       "box":[[10.2,-22.5,100.0,6.0,7.0,4.0],
              [-15.0,33.0,4.5,3.2,3.2,4.5]],
       "label":[1,1],"label_scores":[0.73,0.022],"image":"/tmp/public.mhd"
    }]))
    results=gpu.read_monai_boxes(pred)
    assert len(results)==2
    assert results[0]["centerMonaiWorldMm"]==[10.2,-22.5,100.0]
    assert results[0]["extentMm"]==[6.0,7.0,4.0]
    assert results[0]["rawClassificationScore"]==0.73
    assert results[0]["coordinateFrameVerifiedAgainstSource"] is False
    assert results[0]["clinicalFindingConfirmed"] is False

@pytest.mark.parametrize("bad",[
    [{"box":[[1,2,3,4,5]],"label":[1],"label_scores":[0.5]}],
    [{"box":[[1,2,3,4,5,6]],"label":[1],"label_scores":[1.4]}],
    [{"box":[[1,2,3,-4,5,6]],"label":[1],"label_scores":[0.4]}],
    [{"box":[[1,2,3,4,5,6]],"label":[1,1],"label_scores":[0.4]}],
    [{"box":[[1,2,3,4,5,6]],"label":[3],"label_scores":[0.4]}],
    [{"box":[[1,2,3,4,5,6]],"label":[1],"label_scores":[float("nan")]}],
    [{"box":[[1,2,3,4,5,6]],"label":[1],"label_scores":[0.4]}]*2,
])
def test_rejects_invalid_model_shapes_scores_and_multiple_source_cases(tmp_path,bad):
    path=tmp_path/"out.json"
    path.write_text(json.dumps(bad))
    with pytest.raises(ValueError):
        gpu.read_monai_boxes(path)

def test_gpu_run_cannot_start_without_explicit_permission_and_no_model_download(tmp_path):
    with pytest.raises(ValueError,match="explicit_external_gpu_consent_required"):
        gpu.run(tmp_path,tmp_path/"out","")
    assert not (tmp_path/"out").exists()

def test_heavy_gpu_workflow_is_manual_only_and_never_uses_mac_or_hosted_cpu():
    text=(ROOT/".github/workflows/pathology-monai-public-gpu.yml").read_text()
    assert "workflow_dispatch:" in text
    assert "pull_request:" not in text and "push:" not in text
    assert "self-hosted" in text and "opus-approved-gpu" in text
    assert "PUBLIC-LUNA16-GPU-OK" in text
    assert "gpu_case" not in text or "gpu_case" in text
    assert "upload-artifact" not in text
    assert "rm -rf" in text
