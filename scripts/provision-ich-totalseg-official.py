#!/usr/bin/env python3
"""Fetch ONE official open TotalSegmentator hemorrhage checkpoint (no patient data).

The published GitHub release lists a 325,569,459-byte Dataset150 archive.
An independent publisher signature/SHA is not supplied; pin release/tag/size,
record our SHA256 and safely extract only ordinary ZIP members. Not intended
as a model clinical-provenance attestation.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import urlopen,Request
import zipfile

URL="https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/Dataset150_icb_v0.zip"
SIZE=325569459
MAX_EXPANDED=1600*1024*1024

def download_and_admit(dst:Path,install_root:Path):
    if dst.exists() or install_root.exists() and any(install_root.iterdir()):
        raise ValueError("model_archive_and_install_locations_must_be_empty")
    install_root.mkdir(parents=True,exist_ok=True)
    dst.parent.mkdir(parents=True,exist_ok=True)
    sha=hashlib.sha256()
    written=0
    try:
        with urlopen(Request(URL,headers={"User-Agent":"OpusRadiologyResearch/1.0"}),timeout=100) as response, dst.open("xb") as f:
            if response.url.startswith("http:"):
                raise ValueError("model_archive_redirect_downgraded_to_http")
            while True:
                block=response.read(1024*1024)
                if not block:break
                written+=len(block)
                if written>SIZE:raise ValueError("official_model_archive_size_exceeded")
                sha.update(block)
                f.write(block)
        if written!=SIZE:
            raise ValueError("published_model_archive_size_changed")
        with zipfile.ZipFile(dst) as archive:
            members=archive.infolist()
            if not 1<=len(members)<=250 or sum(e.file_size for e in members)>MAX_EXPANDED:
                raise ValueError("official_model_expansion_exceeds_bound")
            if not any("checkpoint" in e.filename.lower() and
                       e.filename.endswith((".pth",".pt",".pkl")) for e in members):
                raise ValueError("pretrained_ich_checkpoint_not_found")
            for entry in members:
                name=entry.filename
                from pathlib import PurePosixPath
                p=PurePosixPath(name)
                if (p.is_absolute() or ".." in p.parts or not p.parts or
                    p.parts[0]!="Dataset150_icb_v0" or
                    entry.external_attr >>16 & 0o170000 == 0o120000):
                    raise ValueError("unsafe_checkpoint_archive_member")
            archive.extractall(install_root)
        print(json.dumps({"model":"TotalSegmentator cerebral_bleed",
          "officialRelease":"v2.0.0-weights",
          "originalArchiveBytes":written,
          "actualOriginalCheckpointArchiveSha256":sha.hexdigest(),
          "clinicalValidation":False}))
        return sha.hexdigest()
    except BaseException:
        dst.unlink(missing_ok=True)
        if install_root.exists():shutil.rmtree(install_root)
        raise

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--archive",type=Path,required=True)
    p.add_argument("--install-root",type=Path,required=True)
    p.add_argument("--manifest",type=Path,required=True)
    a=p.parse_args()
    digest=download_and_admit(a.archive,a.install_root)
    a.manifest.write_text(json.dumps({"archiveSha256":digest,
      "clinicalValidation":False}),encoding="utf-8")

if __name__=="__main__":main()
