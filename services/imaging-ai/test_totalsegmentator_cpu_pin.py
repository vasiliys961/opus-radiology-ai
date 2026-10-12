from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def test_cpu_torch_cannot_be_replaced_by_totalseg_dependency_resolution():
    constraints=(ROOT/"deploy/totalseg-cpu-constraints.txt").read_text()
    assert "torch==2.6.0+cpu" in constraints
    assert "torchvision==0.21.0+cpu" in constraints
    for name in ("Dockerfile.totalseg-cpu","Dockerfile.totalseg-research"):
        df=(ROOT/"deploy"/name).read_text()
        assert "COPY deploy/totalseg-cpu-constraints.txt /opt/opus/constraints.txt" in df
        assert "--constraint /opt/opus/constraints.txt" in df
        assert '"torch==2.6.0+cpu"' in df
        assert '"torchvision==0.21.0+cpu"' in df
        assert "--index-url https://download.pytorch.org/whl/cpu" in df
