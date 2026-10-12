"""Static regression tests for deliberately non-executable deploy scaffold."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def test_audit_compose_offline_and_without_ports():
    text = (ROOT / "deploy/compose.yaml").read_text()
    assert "network_mode: none" in text
    assert "read_only: true" in text
    assert "no-new-privileges:true" in text
    assert "cap_drop:" in text
    assert "ports:" not in text
    assert "OPUS_TOTALSEG_WEIGHTS_PATH" in text
    assert "OPUS_TOTALSEG_CONFIG_PATH" in text

def test_audit_image_has_no_torch_or_install():
    text = (ROOT / "deploy/Dockerfile.weights-audit").read_text()
    assert "USER 10001:10001" in text
    assert "totalsegmentator_audit.py" in text
    assert "pip install" not in text
    assert "requirements-totalsegmentator.txt" not in text
