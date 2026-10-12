#!/usr/bin/env python3
"""Explicit research-only official TotalSegmentator archive fetch. Never extract/run."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sys
import urllib.request
import zipfile

BASE = "https://github.com/wasserth/TotalSegmentator/releases/download/v2.0.0-weights/"
ARCHIVES = {
    297: ("Dataset297_TotalSegmentator_total_3mm_1559subj.zip", 135386075),
    298: ("Dataset298_TotalSegmentator_total_6mm_1559subj.zip", 134827240),
}
MAX_EXPANDED = 2 * 1024**3

def inspect_zip(path):
    """Bound decompression and reject archive traversal, links and unusual members."""
    total = 0
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if not infos or len(infos) > 1000:
            raise ValueError("archive_member_limit")
        for entry in infos:
            name = entry.filename
            parts = name.replace("\\", "/").split("/")
            if (name.startswith(("/", "\\")) or any(p in ("", ".", "..") for p in parts[:-1])
                    or ":" in parts[0] or (entry.external_attr >> 16) & 0o170000 == 0o120000):
                raise ValueError("unsafe_archive_entry")
            if entry.is_dir():
                continue
            total += entry.file_size
            if total > MAX_EXPANDED:
                raise ValueError("archive_expanded_limit")
    return len(infos), total

def download_archive(task_id, dest, opener=urllib.request.urlopen):
    name, expected_bytes = ARCHIVES[task_id]
    path = dest / name
    if path.exists() or path.is_symlink():
        raise ValueError("destination_exists")
    temp = dest / (name + ".partial")
    if temp.exists() or temp.is_symlink():
        raise ValueError("partial_exists")
    digest = hashlib.sha256()
    count = 0
    try:
        with opener(BASE + name, timeout=60) as response, temp.open("xb") as target:
            while data := response.read(128 * 1024):
                count += len(data)
                if count > expected_bytes:
                    raise ValueError("download_size_mismatch")
                target.write(data)
                digest.update(data)
        if count != expected_bytes:
            raise ValueError("download_size_mismatch")
        members, expanded = inspect_zip(temp)
        temp.rename(path)
        return {"taskId": task_id, "archive": name, "bytes": count,
                "sha256": digest.hexdigest(), "members": members,
                "expandedBytes": expanded, "integrity": "download-size-and-zip-checked",
                "officialDigestIndependentlyVerified": False}
    finally:
        temp.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--research-download", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not args.research_download:
        parser.error("explicit --research-download required")
    dest = args.output.expanduser().absolute()
    if dest.is_symlink():
        parser.error("output symlink not supported")
    dest.mkdir(mode=0o700, parents=True, exist_ok=True)
    if any(dest.iterdir()):
        parser.error("output directory must be empty")
    if shutil.disk_usage(dest).free < sum(x[1] for x in ARCHIVES.values()) + MAX_EXPANDED:
        parser.error("insufficient safe disk reserve")
    result = []
    try:
        for task in ARCHIVES:
            result.append(download_archive(task, dest))
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        print("download_failed: " + type(exc).__name__, file=sys.stderr)
        return 2
    (dest / "manifest.json").write_text(json.dumps({
        "schema": "opus-totalsegmentator-research-download/v1",
        "source": "official GitHub release v2.0.0-weights", "archives": result,
        "checkpointVerified": False, "licenseVerified": False,
        "readyForInference": False}, indent=2))
    print("Downloaded research archives; weights NOT authorized for inference.")
    return 0

if __name__ == "__main__":
    sys.exit(main())
