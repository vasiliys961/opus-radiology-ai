"""No actual model execution in lightweight CI."""
import importlib.util
from pathlib import Path
import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("first_inference",ROOT/"scripts/run-totalseg-first-inference.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def test_explicit_opt_in_required(tmp_path):
    with pytest.raises(ValueError,match="explicit_research_confirmation"):
        m.run(tmp_path/"ct.nii",tmp_path/"models",tmp_path/"out")

def test_preflight_rejects_incomplete_cache_without_docker(tmp_path,monkeypatch):
    src=tmp_path/"ct.nii";src.write_bytes(b"test")
    models=tmp_path/"models";models.mkdir()
    out=tmp_path/"out";out.mkdir()
    monkeypatch.setattr(m,"host_memory_bytes",lambda:16*1024**3)
    with pytest.raises(ValueError,match="model_cache_incomplete"):
        m.prepare(src,models,out)

def test_ram_guard(tmp_path,monkeypatch):
    src=tmp_path/"ct.nii";src.write_bytes(b"test")
    models=tmp_path/"models";models.mkdir()
    out=tmp_path/"out";out.mkdir()
    for folder in m.MODEL_FOLDERS:
        for name in ("plans.json","dataset.json","fold_0/checkpoint_final.pth"):
            p=models/folder/m.TRAINER/name
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_bytes(b"x")
    monkeypatch.setattr(m,"host_memory_bytes",lambda:7*1024**3)
    with pytest.raises(ValueError,match="14_gib"):
        m.prepare(src,models,out)

def test_low_available_memory_refused(tmp_path,monkeypatch):
    src=tmp_path/"ct.nii";src.write_bytes(b"test")
    models=tmp_path/"models";models.mkdir()
    out=tmp_path/"out";out.mkdir()
    for folder in m.MODEL_FOLDERS:
        for name in ("plans.json","dataset.json","fold_0/checkpoint_final.pth"):
            p=models/folder/m.TRAINER/name
            p.parent.mkdir(parents=True,exist_ok=True)
            p.write_bytes(b"x")
    monkeypatch.setattr(m,"host_memory_bytes",lambda:16*1024**3)
    monkeypatch.setattr(m,"available_memory_bytes",lambda:4*1024**3)
    with pytest.raises(ValueError,match="available_ram"):
        m.prepare(src,models,out)

def test_symlink_input_rejected_before_resolve(tmp_path):
    original=tmp_path/"ct.nii";original.write_bytes(b"test")
    link=tmp_path/"linked.nii";link.symlink_to(original)
    models=tmp_path/"models";models.mkdir()
    out=tmp_path/"out";out.mkdir()
    with pytest.raises(ValueError,match="unsafe_symlink"):
        m.prepare(link,models,out)
