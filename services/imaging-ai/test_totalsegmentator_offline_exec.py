from pathlib import Path
import pytest
from totalsegmentator_offline_exec import run,main

def test_disabled_by_default(tmp_path):
    with pytest.raises(ValueError,match="confirmation"):
        run(tmp_path/"absent.nii",tmp_path/"out.nii")

def test_bad_paths_refuse_before_model_import(tmp_path):
    f=tmp_path/"in.nii"
    f.write_bytes(b"test")
    with pytest.raises(ValueError,match="invalid_paths"):
        run(f,f,confirmed=True)
    with pytest.raises(ValueError,match="invalid_paths"):
        run(f,tmp_path/"out.txt",confirmed=True)

def test_no_implicit_cli_execution(tmp_path):
    assert main(["--input",str(tmp_path/"a.nii"),"--output",str(tmp_path/"out.nii")]) == 2

def test_symlink_input_refused(tmp_path):
    f=tmp_path/"input.nii"
    f.write_bytes(b"file")
    link=tmp_path/"link.nii"
    link.symlink_to(f)
    with pytest.raises(ValueError,match="invalid_paths"):
        run(link,tmp_path/"output.nii",confirmed=True)
