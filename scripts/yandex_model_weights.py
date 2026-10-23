#!/usr/bin/env python3
"""Opt-in server-side Yandex Disk weight cache (never patient images).

Yandex OAuth token is read only from environment. Model manifest supplies a
restricted disk:/ path, exact SHA256 and bounded byte size. Download URLs are
obtained from Yandex API; token is NEVER forwarded to signed file hosts.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

API = "https://cloud-api.yandex.net/v1/disk/resources/download"
MAX_WEIGHT_BYTES = 60_000_000_000
BLOCK = 1024 * 1024

def validate(manifest):
    if not isinstance(manifest, dict):
        raise ValueError("invalid model manifest")
    model = manifest.get("modelId")
    path = manifest.get("diskPath")
    digest = manifest.get("sha256")
    size = manifest.get("sizeBytes")
    if not isinstance(model,str) or not re.fullmatch(r"[a-zA-Z0-9_-]{2,80}",model):
        raise ValueError("invalid model identifier")
    if not isinstance(path,str) or not path.startswith("disk:/opus-models/"):
        raise ValueError("only dedicated Yandex disk:/opus-models/ subtree is allowed")
    if any(x in path for x in ("..","\\","?","#","\x00")) or path.endswith("/"):
        raise ValueError("unsafe storage path")
    if not isinstance(digest,str) or not re.fullmatch(r"[a-f0-9]{64}",digest):
        raise ValueError("original checkpoint SHA256 required")
    if type(size) is not int or not 0 < size <= MAX_WEIGHT_BYTES:
        raise ValueError("invalid bounded original checkpoint bytes")
    return model,path,digest,size

def signed_url(path,token):
    if not token:
        raise ValueError("YANDEX_DISK_TOKEN not configured")
    url=API+"?"+urlencode({"path":path})
    req=Request(url,headers={"Authorization":"OAuth "+token,"Accept":"application/json"})
    with urlopen(req,timeout=30) as reply:
        answer=json.load(reply)
    href=answer.get("href")
    if not isinstance(href,str):
        raise ValueError("Yandex Disk did not issue download URL")
    parsed=urlsplit(href)
    host=(parsed.hostname or "").lower()
    if parsed.scheme!="https" or parsed.username or parsed.password or not (
        host in ("yandex.ru","yandex.net") or host.endswith(".yandex.ru") or host.endswith(".yandex.net")
    ):
        raise ValueError("download URL host not trusted")
    return href

def fetch(manifest, root, token):
    model,path,digest,size=validate(manifest)
    base=Path(root).expanduser().resolve()
    base.mkdir(parents=True,exist_ok=True,mode=0o700)
    target=base/(model+"-"+digest+".weights")
    if target.exists():
        if target.is_symlink() or target.stat().st_size!=size:
            raise ValueError("existing cache entry size mismatch")
        if hash_file(target)==digest:
            return {"cached":True,"path":str(target),"sha256":digest,"sizeBytes":size}
        raise ValueError("existing cache entry SHA256 mismatch")
    href=signed_url(path,token)
    tmp=None
    try:
        with tempfile.NamedTemporaryFile(dir=base,prefix=".incoming-",delete=False) as out:
            tmp=Path(out.name)
            h=hashlib.sha256()
            count=0
            with urlopen(Request(href,headers={"Accept":"application/octet-stream"}),timeout=120) as reply:
                while True:
                    data=reply.read(BLOCK)
                    if not data:break
                    count+=len(data)
                    if count>size:raise ValueError("server provided more weight bytes than manifest")
                    out.write(data)
                    h.update(data)
            out.flush()
            os.fsync(out.fileno())
        if count!=size or h.hexdigest()!=digest:
            raise ValueError("original weight size/SHA256 mismatch")
        # Never follow any preexisting cache link or clobber another downloaded file.
        if target.exists():raise ValueError("cache entry appeared during download")
        os.link(tmp,target)
        target.chmod(0o600)
        return {"cached":False,"path":str(target),"sha256":digest,"sizeBytes":size}
    finally:
        if tmp is not None:tmp.unlink(missing_ok=True)

def hash_file(path):
    h=hashlib.sha256()
    with path.open("rb") as src:
        for block in iter(lambda:src.read(BLOCK),b""):h.update(block)
    return h.hexdigest()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--manifest",type=Path,required=True)
    p.add_argument("--cache-root",type=Path,required=True)
    args=p.parse_args()
    report=fetch(json.loads(args.manifest.read_text()),args.cache_root,
                 os.environ.get("YANDEX_DISK_TOKEN",""))
    # Report digest and cache result, never token, signed href or patient data.
    print(json.dumps(report))

if __name__=="__main__":
    main()
