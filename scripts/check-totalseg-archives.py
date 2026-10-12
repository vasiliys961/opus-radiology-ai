#!/usr/bin/env python3
"""Audit official downloaded archives without extraction, Torch, or patient data."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "imaging-ai"))
from totalsegmentator_fetch import ARCHIVES, inspect_zip

def check(directory):
    directory = Path(directory)
    manifest_path = directory / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ValueError("missing_manifest")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != "opus-totalsegmentator-research-download/v1":
        raise ValueError("unexpected_manifest")
    records = manifest.get("archives")
    if not isinstance(records, list) or len(records) != len(ARCHIVES):
        raise ValueError("missing_model_archives")
    by_id = {r.get("taskId"): r for r in records if isinstance(r, dict)}
    if set(by_id) != set(ARCHIVES):
        raise ValueError("unexpected_model_ids")
    result = []
    for task_id, (filename, expected_size) in ARCHIVES.items():
        f = directory / filename
        if f.is_symlink() or not f.is_file() or f.stat().st_size != expected_size:
            raise ValueError("invalid_archive")
        digest = hashlib.sha256()
        with f.open("rb") as handle:
            while part := handle.read(128 * 1024):
                digest.update(part)
        if digest.hexdigest() != by_id[task_id].get("sha256"):
            raise ValueError("archive_digest_mismatch")
        members, expanded = inspect_zip(f)
        with zipfile.ZipFile(f) as z:
            names = [i.filename for i in z.infolist() if not i.is_dir()]
        required = ("plans.json", "dataset.json", "checkpoint_final.pth")
        found = {name: [n for n in names if n.endswith("/" + name)] for name in required}
        if any(not found[name] for name in required):
            raise ValueError("missing_expected_model_files")
        result.append({"taskId": task_id, "archive": filename,
                       "archiveSha256": digest.hexdigest(), "members": members,
                       "expandedBytes": expanded,
                       "samplePaths": {k: v[:2] for k, v in found.items()},
                       "provenanceIndependentlyVerified": False,
                       "licenseVerified": False,
                       "inferenceEnabled": False})
    return {"schema": "opus-total-official-archive-audit/v1", "archives": result,
            "clinicalStatus": "not_validated"}

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--directory", type=Path, required=True)
    args = p.parse_args()
    try:
        print(json.dumps(check(args.directory), indent=2))
        return 0
    except (OSError, ValueError, zipfile.BadZipFile, KeyError, TypeError) as exc:
        print("archive_audit_failed: " + type(exc).__name__, file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
