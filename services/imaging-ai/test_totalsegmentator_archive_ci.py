"""Offline negative tests for downloaded model ZIP verification."""
import importlib.util
import json
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("check_totalseg_archives", ROOT/"scripts/check-totalseg-archives.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def test_missing_manifest_rejected(tmp_path):
    with pytest.raises(ValueError,match="missing_manifest"):
        module.check(tmp_path)

def test_manifest_without_required_archives_rejected(tmp_path):
    (tmp_path/"manifest.json").write_text(json.dumps({
        "schema":"opus-totalsegmentator-research-download/v1","archives":[]}))
    with pytest.raises(ValueError,match="missing_model_archives"):
        module.check(tmp_path)

def test_workflow_never_persists_weights():
    s=(ROOT/".github/workflows/totalseg-official-weights.yml").read_text()
    assert "workflow_dispatch:" in s
    assert "fetch-totalsegmentator-weights.py" in s
    assert "check-totalseg-archives.py" in s
    assert "upload-artifact" not in s
    assert "push:" not in s
    assert "schedule:" not in s
