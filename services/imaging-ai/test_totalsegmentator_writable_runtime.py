from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]

def test_read_only_runtime_uses_writable_tmpfs_cache():
    compose=(ROOT/"deploy/compose.totalseg-research.yaml").read_text()
    docker=(ROOT/"deploy/Dockerfile.totalseg-research").read_text()
    for key in ("HOME","XDG_CACHE_HOME","MPLCONFIGDIR","TORCH_HOME"):
        assert key+": /tmp/opus-home" in compose
        assert key+"=/tmp/opus-home" in docker
    assert "/tmp:size=2g" in compose
    assert "read_only: true" in compose
    assert "network_mode: none" in compose

def test_runner_preflights_cache_write():
    code=(ROOT/"services/imaging-ai/totalsegmentator_offline_exec.py").read_text()
    assert "invalid_runtime_cache_path" in code
    assert "opus-write-probe" in code
