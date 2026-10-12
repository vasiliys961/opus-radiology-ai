import importlib.util
from pathlib import Path
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("first_inference",ROOT/"scripts/run-totalseg-first-inference.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def test_no_raw_logs_are_exposed():
    p=SimpleNamespace(stderr="PermissionError: /home/runner/work/sensitive-path",stdout="")
    assert m.failure_category(p)=="read_only_filesystem"
    assert "sensitive" not in m.failure_category(p)

def test_classify_python_import_failure():
    p=SimpleNamespace(stderr="ModuleNotFoundError: No module named 'xyz'",stdout="")
    assert m.failure_category(p)=="python_import"

def test_unclassified_does_not_echo_secrets():
    p=SimpleNamespace(stderr="private-token-ABC",stdout="")
    assert m.failure_category(p)=="unclassified"
