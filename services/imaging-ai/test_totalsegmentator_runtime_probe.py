import importlib.metadata
from totalsegmentator_runtime_probe import inspect_runtime, main

def test_exact_pinned_versions():
    r = inspect_runtime(lambda name: {"torch":"2.6.0+cpu","TotalSegmentator":"2.18.0"}[name])
    assert r["dependenciesReady"]
    assert r["inferenceEnabled"] is False
    assert r["weightsVerified"] is False

def test_wrong_version_rejected():
    r = inspect_runtime(lambda name: "2.5.0")
    assert not r["dependenciesReady"]

def test_missing_package_rejected():
    def lookup(name):
        raise importlib.metadata.PackageNotFoundError(name)
    assert not inspect_runtime(lookup)["dependenciesReady"]

def test_cli_requires_check_only():
    import pytest
    with pytest.raises(SystemExit):
        main([])

def test_runtime_compose_never_exposes_network_or_patient_data():
    from pathlib import Path
    content = (Path(__file__).resolve().parents[2]/"deploy/compose.totalseg-cpu.yaml").read_text()
    assert "network_mode: none" in content and "read_only: true" in content
    assert "ports:" not in content and "weights" not in content
