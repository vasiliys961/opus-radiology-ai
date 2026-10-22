#!/usr/bin/env python3
"""Fetch CompAI GitLab Model 7 original LFS checkpoint on a research Linux runner.

Produces provenance evidence, not clinical validation. No patient CT is used.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

URL = "https://gitlab.lrz.de/compai/MediastinalLymphNodeSegmentation.git"
TAG = "Model7-Technical-Report"
MAX_BYTES = 3_000_000_000

def run(command, cwd=None, timeout=180):
    return subprocess.run(command, cwd=cwd, check=True, capture_output=True,
                          text=True, timeout=timeout).stdout.strip()

def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""):
            digest.update(block)
    return digest.hexdigest()

def audit(directory):
    folder = Path(directory)
    output = {"schema":"opus-compai-lnq7-original-weights/v1",
              "publisher":URL,"tag":TAG,"downloadVerified":False,
              "actualTrainedForward":False,"clinicalValidation":False,
              "checkpointFiles":[]}
    env = dict(os.environ, GIT_LFS_SKIP_SMUDGE="1", GIT_TERMINAL_PROMPT="0")
    try:
        subprocess.run(["git","clone","--depth","1","--branch",TAG,URL,str(folder)],
                       env=env, check=True, capture_output=True, timeout=240)
        output["commit"] = run(["git","rev-parse","HEAD"],cwd=folder)
        candidates = []
        for path in folder.glob("lnq_segmentation/nnunet/**/*"):
            if not path.is_file() or path.name not in ("checkpoint_final.pth","checkpoint_best.pth"):
                continue
            pointer = path.read_bytes()[:220]
            match = re.search(rb"oid sha256:([a-f0-9]{64})\nsize ([0-9]+)",pointer)
            if match and int(match.group(2)) < MAX_BYTES:
                candidates.append((path,match.group(1).decode(),int(match.group(2))))
        if not candidates:
            raise ValueError("No original nnUNet checkpoint Git LFS pointers in published tag")
        path, expected, expected_size = sorted(candidates,key=lambda x:str(x[0]))[0]
        output["checkpointFiles"]=[{"path":str(path.relative_to(folder)),
            "publishedLfsSha256":expected,"publishedBytes":expected_size}]
        subprocess.run(["git","lfs","pull","--include",str(path.relative_to(folder)),"--exclude",""],
                       cwd=folder,check=True,capture_output=True,timeout=1200)
        actual = sha256(path)
        if path.stat().st_size != expected_size or actual != expected:
            raise ValueError("GitLab model checkpoint bytes do not match original Git LFS SHA256")
        output["downloadVerified"]=True
        output["checkpointFiles"][0]["actualSha256"]=actual
        output["status"]="original_checkpoint_verified"
    except Exception as exc:
        output["status"]="unavailable"
        output["blockerType"]=type(exc).__name__
        output["blocker"]=str(exc)[:400]
    return output

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",required=True,type=Path)
    args=p.parse_args()
    if args.output.exists():
        raise ValueError("No stale evidence replacement")
    with tempfile.TemporaryDirectory(prefix="compai-model7-") as d:
        report = audit(Path(d)/"repo")
    args.output.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps(report))
    if not report["downloadVerified"]:
        raise SystemExit(2)

if __name__=="__main__":
    main()
