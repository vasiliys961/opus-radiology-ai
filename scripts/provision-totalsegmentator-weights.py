#!/usr/bin/env python3
"""Offline provision of predownloaded research model archives; no inference/network."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import zipfile

ARCHIVES = {
  297: ("Dataset297_TotalSegmentator_total_3mm_1559subj.zip",
        "0baa2c8de2975600eb31801dd5c1825cd2b356f794498659cf3348714c073394"),
  298: ("Dataset298_TotalSegmentator_total_6mm_1559subj.zip",
        "b1832acde46c0f76cc9aba599e49e986c21c94e522ade4d920602b227e9d6c63"),
}
TRAINER="nnUNetTrainer_4000epochs_NoMirroring__nnUNetPlans__3d_fullres"
MAX_ARCHIVE_MEMBERS=1000
MAX_EXPANDED_BYTES=2*1024**3

def digest_file(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        while chunk:=f.read(128*1024):
            h.update(chunk)
    return h.hexdigest()

def verify_zip(path, dataset):
    if path.is_symlink() or not path.is_file():
        raise ValueError("invalid_archive")
    root=f"Dataset{dataset}_TotalSegmentator_total_{3 if dataset==297 else 6}mm_1559subj"
    total=0
    paths=set()
    with zipfile.ZipFile(path) as z:
        items=z.infolist()
        if len(items)>MAX_ARCHIVE_MEMBERS or not items:
            raise ValueError("archive_member_limit")
        for item in items:
            parts=PurePosixPath(item.filename).parts
            mode=(item.external_attr >> 16) & 0o170000
            if (not parts or parts[0]!=root or item.filename.startswith("/")
                    or "\\" in item.filename or any(p in (".","..") for p in parts)
                    or mode not in (0,stat.S_IFREG,stat.S_IFDIR)):
                raise ValueError("unsafe_archive_entry")
            if item.is_dir():
                continue
            total+=item.file_size
            if total>MAX_EXPANDED_BYTES:
                raise ValueError("archive_expanded_limit")
            if item.filename in paths:
                raise ValueError("duplicate_archive_entry")
            paths.add(item.filename)
        for required in ("plans.json","dataset.json","fold_0/checkpoint_final.pth"):
            if f"{root}/{TRAINER}/{required}" not in paths:
                raise ValueError("incomplete_model_archive")
    return root

def provision(source, destination):
    source=Path(source)
    destination=Path(destination)
    if destination.exists() or destination.is_symlink():
        raise ValueError("destination_must_not_exist")
    if not source.is_dir() or source.is_symlink():
        raise ValueError("invalid_source")
    prepared=[]
    for tid,(name,expected_sha) in ARCHIVES.items():
        path=source/name
        if digest_file(path)!=expected_sha:
            raise ValueError("archive_sha_mismatch")
        root=verify_zip(path,tid)
        prepared.append((tid,path,root,expected_sha))
    destination.mkdir(mode=0o700,parents=False)
    try:
        for _,path,_,_ in prepared:
            with zipfile.ZipFile(path) as z:
                for item in z.infolist():
                    if item.is_dir():
                        continue
                    outfile=destination/item.filename
                    outfile.parent.mkdir(parents=True,exist_ok=True)
                    with z.open(item) as src, outfile.open("xb") as out:
                        remaining=item.file_size
                        while remaining:
                            data=src.read(min(128*1024,remaining))
                            if not data:
                                raise ValueError("truncated_archive_entry")
                            out.write(data)
                            remaining-=len(data)
                        if src.read(1):
                            raise ValueError("oversized_archive_entry")
        return {"schema":"opus-totalseg-offline-provision/v1",
                "datasets":[{"id":i,"folder":folder,"archiveSha256":sha}
                            for i,_,folder,sha in prepared],
                "readyForClinicalUse":False,"provenanceIndependentlyVerified":False}
    except BaseException:
        shutil.rmtree(destination)
        raise

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--archives",type=Path,required=True)
    p.add_argument("--destination",type=Path,required=True)
    p.add_argument("--research-provision",action="store_true")
    a=p.parse_args()
    if not a.research_provision:
        p.error("--research-provision required")
    try:
        result=provision(a.archives,a.destination)
    except (ValueError,OSError,zipfile.BadZipFile):
        print("provision_failed",file=sys.stderr)
        return 2
    print(json.dumps(result,sort_keys=True))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
