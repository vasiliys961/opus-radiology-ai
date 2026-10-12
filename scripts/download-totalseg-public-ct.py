#!/usr/bin/env python3
"""Download upstream public TotalSegmentator example CT, bounded gzip expansion."""
import argparse
import gzip
import hashlib
from pathlib import Path
import shutil
import urllib.request

URL="https://raw.githubusercontent.com/wasserth/TotalSegmentator/master/tests/reference_files/example_ct_sm.nii.gz"
MAX_COMPRESSED=100*1024*1024
MAX_EXPANDED=160*1024*1024

def copy_bounded(src,dst,limit):
    count=0
    while chunk:=src.read(128*1024):
        count+=len(chunk)
        if count>limit:
            raise ValueError("example_ct_exceeds_size_limit")
        dst.write(chunk)
    return count

def download(output,opener=urllib.request.urlopen):
    output=Path(output)
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("invalid_output")
    gz=output.with_suffix(".nii.gz")
    if gz.exists() or gz.is_symlink():
        raise ValueError("gzip_destination_exists")
    try:
        with opener(URL,timeout=60) as response, gz.open("xb") as f:
            if getattr(response,"status",200)!=200:
                raise ValueError("bad_download_status")
            copy_bounded(response,f,MAX_COMPRESSED)
        with gzip.open(gz,"rb") as f,output.open("xb") as out:
            copy_bounded(f,out,MAX_EXPANDED)
        return {"bytes":output.stat().st_size,
                "sha256":hashlib.file_digest(output.open("rb"),"sha256").hexdigest()}
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    finally:
        gz.unlink(missing_ok=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    print(download(a.output))
if __name__=="__main__":
    main()
