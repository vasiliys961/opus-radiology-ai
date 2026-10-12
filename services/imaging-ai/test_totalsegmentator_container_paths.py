"""Check official TotalSegmentator config/weight paths are separated in Docker."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def test_model_weights_read_only_but_metadata_writable():
    df=(ROOT/"deploy/Dockerfile.totalseg-research").read_text()
    compose=(ROOT/"deploy/compose.totalseg-research.yaml").read_text()
    assert "TOTALSEG_WEIGHTS_PATH=/models" in df
    assert "TOTALSEG_HOME_DIR=/tmp/opus-totalseg-config" in df
    assert "TOTALSEG_HOME_DIR: /tmp/opus-totalseg-config" in compose
    assert "TOTALSEG_WEIGHTS_PATH: /models" in compose
    assert "target: /models" in compose and "read_only: true" in compose
    assert "/tmp:size=" in compose and "network_mode: none" in compose
    assert "ports:" not in compose
