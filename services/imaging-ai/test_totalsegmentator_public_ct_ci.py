from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def test_public_ct_real_model_workflow_stays_opt_in():
    wf=(ROOT/".github/workflows/totalseg-public-ct-inference.yml").read_text()
    assert "workflow_dispatch:" in wf
    assert "runs-on: ubuntu-latest" in wf
    assert "run-totalseg-first-inference.py" in wf
    assert "--research-confirmed" in wf
    assert "timeout-minutes: 55" in wf
    assert "timeout --signal=TERM" in wf
    assert "upload-artifact" not in wf
    assert "push:" not in wf and "schedule:" not in wf

def test_public_ct_is_open_upstream_example():
    source=(ROOT/"scripts/download-totalseg-public-ct.py").read_text()
    assert "wasserth/TotalSegmentator" in source
    assert "example_ct_sm.nii.gz" in source
    assert "MAX_EXPANDED=" in source
