#!/usr/bin/env python3
"""Fetch ONLY original publisher LungSCAPE191 5-fold archive for opt-in public research."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
from urllib.request import urlopen

URL = "https://zenodo.org/records/18860414/files/Dataset191_HighAttenuation.zip?download=1"
PUBLISHER_MD5 = "14d9d057b79d45e3a49c54fdaf76b7fa"
MIN_BYTES = 500_000_000
MAX_BYTES = 2_000_000_000


def download(directory):
    if directory.exists():
        raise ValueError("private weights directory already exists; never reuse stale archives")
    directory.mkdir(parents=True, mode=0o700)
    path = directory / "Dataset191_HighAttenuation.zip"
    md5, sha = hashlib.md5(), hashlib.sha256()
    total = 0
    with urlopen(URL, timeout=90) as reply, path.open("xb") as target:
        while chunk := reply.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_BYTES:
                raise ValueError("original archive exceeds bounded size")
            md5.update(chunk)
            sha.update(chunk)
            target.write(chunk)
    if total < MIN_BYTES or md5.hexdigest() != PUBLISHER_MD5:
        path.unlink(missing_ok=True)
        raise ValueError("publisher original model archive size/MD5 mismatch")
    report = {
        "schema": "opus-lungscape191-original-weights/v1",
        "publisherUrl": URL,
        "archive": "Dataset191_HighAttenuation.zip",
        "originalAuthorPublishedMd5": PUBLISHER_MD5,
        "observedSha256": sha.hexdigest(),
        "archiveBytes": total,
        "checkpointContentsVerifiedAfterInstall": False,
        "genuineModelInferenceCompleted": False,
        "clinicalValidation": False,
    }
    (directory / "numeric-original-weight-manifest.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf8"
    )
    print(json.dumps(report, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-private", type=Path, required=True)
    parser.add_argument("--execute-download", action="store_true")
    a = parser.parse_args()
    if not a.execute_download:
        print("Not downloaded. Supply --execute-download for public researcher opt-in.")
        return 0
    try:
        download(a.output_private.expanduser().resolve())
    except (ValueError, OSError, TimeoutError) as exc:
        print("Original publisher archive rejected: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
