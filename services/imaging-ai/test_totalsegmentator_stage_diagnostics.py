from pathlib import Path
import importlib.util
from types import SimpleNamespace
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("runner",ROOT/"scripts/run-totalseg-first-inference.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def test_parses_only_known_diagnostic_values():
    p=SimpleNamespace(stderr='{"status":"failed","stage":"model_import","error":"RuntimeError"}\n')
    assert m.reported_stage(p)=={"stage":"model_import","errorType":"RuntimeError"}
    p=SimpleNamespace(stderr='{"status":"failed","stage":"/private/path","error":"secret"}\n')
    assert m.reported_stage(p)=={"stage":"unknown","errorType":"unknown"}

def test_executor_has_all_model_stage_boundaries():
    e=(ROOT/"services/imaging-ai/totalsegmentator_offline_exec.py").read_text()
    for label in ("input_preflight","input_nifti_load","runtime_cache","model_import","model_inference","mask_validation"):
        assert 'reached("'+label+'")' in e
