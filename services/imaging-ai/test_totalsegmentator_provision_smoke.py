import importlib.util
from pathlib import Path
import json
import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("verify_weights",ROOT/"scripts/verify-totalsegmentator-provision.py")
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def test_missing_model_files_are_rejected(tmp_path):
    with pytest.raises(ValueError,match="missing_model_file"):
        m.verify(tmp_path)

def test_detect_empty_checkpoint(tmp_path):
    base=tmp_path/m.DATASETS[297]/m.TRAINER
    (base/"fold_0").mkdir(parents=True)
    (base/"plans.json").write_text(json.dumps({}))
    (base/"dataset.json").write_text(json.dumps({}))
    (base/"fold_0"/"checkpoint_final.pth").write_bytes(b"")
    with pytest.raises(ValueError,match="invalid_model_file_size"):
        m.verify(tmp_path)

def test_workflow_is_manual_and_does_not_publish_models():
    w=(ROOT/".github/workflows/totalseg-provision-smoke.yml").read_text()
    assert "workflow_dispatch:" in w
    assert "provision-totalsegmentator-weights.py" in w
    assert "verify-totalsegmentator-provision.py" in w
    assert "if: always()" in w
    assert "upload-artifact" not in w
    assert "schedule:" not in w
    assert "push:" not in w
