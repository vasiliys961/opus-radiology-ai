import importlib.util
from pathlib import Path
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
executor=load("executor","services/imaging-ai/totalsegmentator_offline_exec.py")
wrapper=load("wrapper","scripts/run-totalseg-first-inference.py")
def test_only_known_mask_errors_are_reported():
    assert executor.safe_mask_rejection(ValueError("invalid_mask_header"),"mask_validation")=="invalid_mask_header"
    assert executor.safe_mask_rejection(ValueError("secret /home/runner"),"mask_validation")=="unrecognized_validation_error"
    assert executor.safe_mask_rejection(ValueError("invalid_mask_header"),"model_import") is None
def test_host_never_echoes_untrusted_text():
    p=SimpleNamespace(stderr='{"status":"failed","error":"ValueError","stage":"mask_validation","maskRejection":"mask_geometry_mismatch"}')
    assert wrapper.reported_stage(p)["maskRejection"]=="mask_geometry_mismatch"
    p=SimpleNamespace(stderr='{"status":"failed","error":"ValueError","stage":"mask_validation","maskRejection":"secret"}')
    assert "maskRejection" not in wrapper.reported_stage(p)
