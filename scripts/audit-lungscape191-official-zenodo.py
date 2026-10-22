#!/usr/bin/env python3
"""Validate original LungSCAPE191 Zenodo pretrained model ZIP bytes.

Downloads on an isolated CI worker. Never handles private patient images.
A successful archive audit is NOT a model forward or ILD diagnosis.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

URL = "https://zenodo.org/records/18860414/files/Dataset191_HighAttenuation.zip?download=1"
PUBLISHER_MD5 = "14d9d057b79d45e3a49c54fdaf76b7fa"
MAX_BYTES = 2_400_000_000

def audit():
    md5 = hashlib.md5()
    sha = hashlib.sha256()
    total = 0
    magic = b""
    req = urllib.request.Request(URL, headers={"User-Agent": "Opus-Research-Checkpoint-Audit/1"})
    with urllib.request.urlopen(req, timeout=120) as stream:
        while block := stream.read(1024 * 1024):
            if total == 0:
                magic = block[:4]
            total += len(block)
            if total > MAX_BYTES:
                raise ValueError("model_archive_exceeds_resource_budget")
            sha.update(block)
            md5.update(block)
    if magic[:2] != b"PK" or total < 100_000_000:
        raise ValueError("original_pretrained_Zenodo_resource_not_zip")
    if md5.hexdigest() != PUBLISHER_MD5:
        raise ValueError("original_Zenodo_model_MD5_mismatch")
    return {"schema": "opus-lungscape191-original-zenodo-archive/v1",
            "officialArchiveURL": URL, "publisherMD5": PUBLISHER_MD5,
            "originalArchiveBytes": total, "observedSHA256": sha.hexdigest(),
            "publisherArchiveVerified": True, "realModelInference": False,
            "clinicalValidation": False, "automaticClinicalUse": False,
            "target": "high attenuation abnormalities, not UIP/IPF classification"}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Refuse stale provenance report")
    evidence = audit()
    args.output.write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence))

if __name__ == "__main__":
    main()
