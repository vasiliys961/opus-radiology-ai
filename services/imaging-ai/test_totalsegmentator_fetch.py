import io
import zipfile
import pytest
from pathlib import Path
from totalsegmentator_fetch import inspect_zip, download_archive

def archive(tmp_path, files):
    path = tmp_path/"test.zip"
    with zipfile.ZipFile(path,"w") as z:
        for name, value in files.items():
            z.writestr(name, value)
    return path

def test_safe_archive(tmp_path):
    assert inspect_zip(archive(tmp_path,{"model/plans.json":"{}"}))[0]==1

def test_traversal_refused(tmp_path):
    with pytest.raises(ValueError,match="unsafe_archive"):
        inspect_zip(archive(tmp_path,{"../escape":"bad"}))

def test_reject_empty_archive(tmp_path):
    with pytest.raises(ValueError,match="archive_member"):
        inspect_zip(archive(tmp_path,{}))

def test_expanded_limit(tmp_path,monkeypatch):
    import totalsegmentator_fetch as m
    monkeypatch.setattr(m,"MAX_EXPANDED",2)
    with pytest.raises(ValueError,match="expanded"):
        inspect_zip(archive(tmp_path,{"large":"hello"}))

def test_download_error_cleans_partial(tmp_path,monkeypatch):
    import totalsegmentator_fetch as m
    monkeypatch.setattr(m,"ARCHIVES",{297:("test.zip",20)})
    class Response:
        def __enter__(self): return io.BytesIO(b"broken")
        def __exit__(self,*args): pass
    with pytest.raises(ValueError,match="size"):
        download_archive(297,tmp_path,opener=lambda *args,**kwargs:Response())
    assert not (tmp_path/"test.zip.partial").exists()
