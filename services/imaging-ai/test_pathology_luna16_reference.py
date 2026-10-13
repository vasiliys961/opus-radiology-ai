"""Only synthetic fixture is allowed in default CI.
A separate lightweight GH step downloads genuine published annotation CSV and
verifies genuine pretrained 83 MB checkpoint without executing the model.
"""
import importlib.util
import hashlib
import json
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[2]
script=ROOT/"scripts/check-luna16-nodule-reference.py"
spec=importlib.util.spec_from_file_location("luna16_reference",script)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def reference(tmp_path,text=None):
    text=text if text is not None else (
        "seriesuid,coordX,coordY,coordZ,diameter_mm\n"
        "1.2.3.4,-125.25,-87,20,5.1\n"
        "1.2.3.4,-110.3,-44.1,25,12.5\n"
        "1.2.3.5,35.8,9.2,101.7,6.4\n"
    )
    f=tmp_path/"annotations.csv"
    f.write_text(text,encoding="utf-8")
    return f

def test_real_published_monai_checkpoint_provenance_is_pinned_but_not_executed():
    m=module.registry_model()
    assert m["version"]=="0.6.9"
    assert m["artifact"]["sha256"]==module.CHECKPOINT_SHA
    assert m["artifact"]["revision"]==module.CHECKPOINT_REV
    assert m["integrationStatus"]=="not_connected"
    assert m["milestones"]["genuineInferenceOnPublicCtObserved"] is False
    assert m["allowedForPatientUse"] is False
    assert m["license"]["weightsAndDependenciesClearedForClinicalUse"] is False

def test_reference_summary_reports_actual_annotations_only(tmp_path):
    f=reference(tmp_path)
    r=module.summarize_real_references(f)
    assert r["referenceNodules"]==3
    assert r["positiveSeriesWithNoduleAnnotations"]==2
    assert r["diameterGroups"]=={
        "3_to_under_6_mm":1,"6_to_under_10_mm":1,"10_mm_or_larger":1
    }
    assert r["readyReferenceExample"]["groundTruthOnly"] is True
    assert len(r["readyReferenceExample"]["publishedNoduleCoordinatesLpsMm"])==2
    assert r["readyReferenceExample"]["sourceIdSha256"]==hashlib.sha256(b"1.2.3.4").hexdigest()
    assert "1.2.3.4" not in json.dumps(r)
    assert r["modelCandidates"] is None
    assert r["detectionSensitivity"] is None
    assert r["froc"] is None
    assert r["specificity"] is None
    assert r["genuineModelInferencePerformed"] is False
    assert r["readyForClinicalUse"] is False

@pytest.mark.parametrize("line",[
    "1.2.3.4,,1,2,4.5",
    "1.2.3.4,nan,1,2,4.5",
    "1.2.3.4,1,inf,2,4.5",
    "1.2.3.4,1,2,3,-4",
    "1.2.3.4,1,2,3,0",
    "fake,1,2,3,4",
    "1.2.3.4,1,2,3",
])
def test_fail_closed_on_invalid_nodule_reference(tmp_path,line):
    f=reference(tmp_path,"seriesuid,coordX,coordY,coordZ,diameter_mm\n"+line+"\n")
    with pytest.raises(ValueError):
        module.read_annotations(f)

def test_csv_encoding_and_size_are_bounded(tmp_path):
    f=reference(tmp_path)
    f.write_bytes(b"x"*600000)
    with pytest.raises(ValueError,match="oversize"):
        module.read_annotations(f)
    f.write_bytes(b"seriesuid,coordX,coordY,coordZ,diameter_mm\n\x00")
    with pytest.raises(ValueError,match="encoding"):
        module.read_annotations(f)

def test_checkpoint_bytes_wrong_digest_do_not_count_as_verified(tmp_path,monkeypatch):
    f=reference(tmp_path)
    fake=tmp_path/"model.pt"
    # Truncated checkpoint is rejected without attempting torch.load / pickle.
    fake.write_bytes(b"pickle-checkpoint-must-not-run")
    with pytest.raises(ValueError,match="checkpoint_size"):
        module.summarize_real_references(f,check_checkpoint=fake)

def test_unsupported_registry_state_is_rejected(tmp_path):
    m=module.registry_model()
    m["models"] = []
    f=tmp_path/"registry.json"
    f.write_text(json.dumps({"schema":"opus-pathology-model-registry/v1","models":[]}))
    with pytest.raises(ValueError,match="invalid_registry"):
        module.registry_model(f)
