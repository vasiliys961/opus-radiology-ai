#!/usr/bin/env python3
"""Prove actual publisher-linked QTIM Brain-Mets-Seg fold-0 checkpoint bytes.

No patient MRI. Checkpoint source is exact upstream pinned Dockerfile, SHA256
is *observed* here, not publisher-signed. Do not count as real inference.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

UPSTREAM="https://github.com/QTIM-Lab/Brain-Mets-Seg"
UPSTREAM_COMMIT="02d100e106b7076c66293ebcf6e122f8eb8e6e9e"
FILES={
 "checkpoint":"https://www.dropbox.com/scl/fi/3i951l43jxy653bcurrz0/checkpoint?rlkey=mt23dsd3axjbadncabcdi0anf&st=zypk1njw&dl=0",
 "ckpt-best-978.index":"https://www.dropbox.com/scl/fi/fc39vcxfdqp0owp445o67/ckpt-best-978.index?rlkey=bczxks3bczwe50g325f7yd021&st=mklcax7x&dl=0",
 "ckpt-best-978.data-00000-of-00001":"https://www.dropbox.com/scl/fi/n3kr6edpxvfw900tf080q/ckpt-best-978.data-00000-of-00001?rlkey=1lhl3y9z6u57n27vxtqwvh1g6&st=mb94841u&dl=0"
}
LIMITS={
 "checkpoint":160*1024,
 "ckpt-best-978.index":256*1024**2,
 "ckpt-best-978.data-00000-of-00001":2*1024**3
}
MINIMUM={
 "checkpoint":15,
 "ckpt-best-978.index":1024,
 "ckpt-best-978.data-00000-of-00001":1024**2
}

def official_dropbox_origin(url):
    parsed=urllib.parse.urlsplit(url)
    host=parsed.hostname or ""
    return parsed.scheme=="https" and (host=="dropbox.com" or host.endswith(".dropbox.com")
      or host=="dropboxusercontent.com" or host.endswith(".dropboxusercontent.com"))

def fetch_one(name,url,folder):
    if name not in FILES or url!=FILES[name]:
        raise ValueError("not_exact_original_vendor_source")
    direct=url.replace("&dl=0","&dl=1")
    if not official_dropbox_origin(direct):
        raise ValueError("source_is_not_upstream_published_Dropbox")
    target=folder/name
    request=urllib.request.Request(direct,headers={"User-Agent":"OpusOriginalCheckpointResearch/1"})
    with urllib.request.urlopen(request,timeout=110) as response:
        if not official_dropbox_origin(response.url) or response.status!=200:
            raise ValueError("untrusted_checkpoint_publisher_redirect")
        digest=hashlib.sha256()
        total=0
        with target.open("xb") as stream:
            while block:=response.read(1024**2):
                total+=len(block)
                if total>LIMITS[name]:
                    raise ValueError("publisher_checkpoint_file_exceeds_limit")
                digest.update(block)
                stream.write(block)
    if total<MINIMUM[name]:
        raise ValueError("publisher_checkpoint_file_missing_or_too_small")
    with target.open("rb") as f:
        prefix=f.read(512)
    if b"<html" in prefix.lower() or b"<!doctype html" in prefix.lower():
        raise ValueError("received_Dropbox_HTML_instead_of_original_model_weights")
    if name=="checkpoint" and (b"model_checkpoint_path" not in prefix
         or b"ckpt-best-978" not in prefix):
        raise ValueError("original_checkpoint_pointers_incompatible")
    return {
        "vendorFilename":name,
        "originalBytes":total,
        "observedSha256":digest.hexdigest(),
        "verifiedAsOriginalByVendorSignature":False
    }

def run(out,folder):
    if out.exists() or out.is_symlink() or out.suffix!=".json" or not out.parent.is_dir():
        raise ValueError("new_only_numeric_checkpoint_report_required")
    if folder.exists() or folder.is_symlink():
        raise ValueError("new_ephemeral_original_checkpoint_folder_required")
    folder.mkdir(mode=0o700,parents=True)
    report=[]
    try:
        for name, url in FILES.items():
            report.append(fetch_one(name,url,folder))
        summary={
            "schema":"opus-brain-mets-original-vendor-fold0-checkpoint/v1",
            "originalPublisher":"QTIM-Lab/Brain-Mets-Seg",
            "publisherSourceCommit":UPSTREAM_COMMIT,
            "modelSource":"original-author-Dockerfile-Model_0",
            "sourceCodeAndModelLicenseReportedByPublisher":"Apache-2.0",
            "checkpointParts":report,
            "publisherSignatureAuthenticated":False,
            "trainedTensorflowCheckpointFormatLoaded":False,
            "fiveFoldEnsembleComplete":False,
            "realBrainMRIInferencePerformed":False,
            "patientModeAllowed":False,
            "researchOnly":True
        }
        out.write_text(json.dumps(summary,indent=2)+"\n")
        print(json.dumps(summary,indent=2))
    finally:
        for filename in FILES:
            (folder/filename).unlink(missing_ok=True)
        try:folder.rmdir()
        except OSError:pass

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--model-dir",required=True,type=Path)
    a=p.parse_args()
    run(a.output,a.model_dir)
