from pathlib import Path

def test_manual_real_image_smoke_has_no_patient_inference():
    root=Path(__file__).resolve().parents[2]
    w=(root/".github/workflows/totalseg-server-smoke.yml").read_text()
    assert "workflow_dispatch:" in w
    assert "docker build --pull" in w
    assert "Dockerfile.totalseg-research" in w
    assert "--network none" in w
    assert "TotalSegmentator" in w and '"2.18.0"' in w
    assert "/does-not-exist.nii" in w
    assert "--research-confirmed" not in w
    assert "push:" not in w and "schedule:" not in w
