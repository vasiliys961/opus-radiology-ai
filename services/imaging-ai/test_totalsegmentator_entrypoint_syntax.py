"""The production Docker entrypoint must compile before a heavy manual runner is used."""
import ast
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]

def test_real_inference_entrypoint_compiles():
    file=ROOT/"services/imaging-ai/totalsegmentator_offline_exec.py"
    ast.parse(file.read_text(encoding="utf-8"),filename=str(file))

def test_all_server_python_entries_compile():
    for name in ("totalsegmentator_input.py","totalsegmentator_result.py","totalsegmentator_audit.py"):
        f=ROOT/"services/imaging-ai"/name
        ast.parse(f.read_text(encoding="utf-8"),filename=str(f))
