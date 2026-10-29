#!/usr/bin/env python3
"""One-command, pinned original NIH XRV checkpoint cache.

Official publisher HTTPS by default, or existing private Yandex Disk model
cache when a manifest and YANDEX_DISK_TOKEN are supplied. NEVER stores DICOM.
No arbitrary URLs, arbitrary weights, or unverified checkpoints accepted.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
from urllib.request import Request, urlopen

from yandex_model_weights import fetch as fetch_yandex

MODEL_ID="densenet121-res224-nih"
FILE="nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt"
SHA="31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf"
PUBLISHER="https://github.com/mlmed/torchxrayvision/releases/download/v1/"+FILE
MAX_BYTES=90*1024*1024
MIN_BYTES=10*1024*1024


def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):h.update(block)
    return h.hexdigest()


def verified_original(path):
    file=Path(path)
    if file.is_symlink() or not file.is_file() or (
        not MIN_BYTES<=file.stat().st_size<=MAX_BYTES or digest(file)!=SHA
    ):
        raise ValueError("original_publisher_model_weight_SHA256_mismatch")
    return file


def provision(root, *, yandex_manifest=None, token="", downloader=urlopen):
    base=Path(root).expanduser().resolve()
    base.mkdir(parents=True,exist_ok=True,mode=0o700)
    target=base/FILE
    if target.exists() or target.is_symlink():
        verified_original(target)
        return {"ready":True,"cached":True,"modelId":MODEL_ID,
                "sha256":SHA,"file":str(target),"storage":"verified-local"}
    incoming=None
    try:
        if yandex_manifest is not None:
            manifest=json.loads(Path(yandex_manifest).read_text())
            if manifest.get("modelId")!=MODEL_ID or manifest.get("sha256")!=SHA:
                raise ValueError("untrusted_Yandex_model_manifest_for_original_XRV")
            result=fetch_yandex(manifest,base/"_immutable_cache",token)
            existing=verified_original(result["path"])
            with tempfile.NamedTemporaryFile(dir=base,prefix=".original-",delete=False) as tmp:
                incoming=Path(tmp.name)
            shutil.copyfile(existing,incoming)
            storage="yandex-cache"
        else:
            with tempfile.NamedTemporaryFile(dir=base,prefix=".original-",delete=False) as tmp:
                incoming=Path(tmp.name)
                h=hashlib.sha256();size=0
                # The URL is an exact constant from the trusted model publisher.
                with downloader(Request(PUBLISHER,headers={
                     "User-Agent":"OpusRadiologyResearch/1.0"}),timeout=180) as response:
                    while True:
                        part=response.read(1024*1024)
                        if not part:break
                        size+=len(part)
                        if size>MAX_BYTES:raise ValueError("original_XRV_model_size_over_budget")
                        h.update(part);tmp.write(part)
                tmp.flush();os.fsync(tmp.fileno())
            if size<MIN_BYTES or h.hexdigest()!=SHA:
                raise ValueError("original_publisher_model_weight_SHA256_mismatch")
            storage="publisher"
        verified_original(incoming)
        if target.exists() or target.is_symlink():
            raise ValueError("target_changed_during_original_weight_download")
        os.link(incoming,target)
        target.chmod(0o600)
        verified_original(target)
        return {"ready":True,"cached":False,"modelId":MODEL_ID,
                "sha256":SHA,"file":str(target),"storage":storage}
    finally:
        if incoming:incoming.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root",default="~/.cache/opus-radiology/original-models/xrv")
    parser.add_argument("--yandex-manifest",type=Path)
    args=parser.parse_args()
    print(json.dumps(provision(args.root,yandex_manifest=args.yandex_manifest,
                               token=os.environ.get("YANDEX_DISK_TOKEN",""))))


if __name__=="__main__":
    main()
