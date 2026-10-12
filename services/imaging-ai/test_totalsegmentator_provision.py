import importlib.util
from pathlib import Path
import zipfile
import pytest

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location("provision_totalseg",ROOT/"scripts/provision-totalsegmentator-weights.py")
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def test_missing_archives_fail_without_writing(tmp_path):
    dest=tmp_path/"out"
    with pytest.raises((ValueError,OSError)):
        m.provision(tmp_path,dest)
    assert not dest.exists()

def test_archive_traversal_refused(tmp_path):
    p=tmp_path/"fake.zip"
    with zipfile.ZipFile(p,"w") as z:
        z.writestr("Dataset297_TotalSegmentator_total_3mm_1559subj/../escape","bad")
    with pytest.raises(ValueError,match="unsafe"):
        m.verify_zip(p,297)

def test_never_replace_existing_destination(tmp_path):
    d=tmp_path/"already";d.mkdir()
    with pytest.raises(ValueError,match="destination"):
        m.provision(tmp_path,d)
