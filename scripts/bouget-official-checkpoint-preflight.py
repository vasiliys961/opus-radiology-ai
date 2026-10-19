#!/usr/bin/env python3
"""Publisher-only weights gate for Bouget et al. mediastinal node model.

This NEVER loads untrusted HDF5/checkpoint/pickle, never touches patient images
or starts the old TensorFlow runtime. It verifies the *author pinned* archive,
measures each payload and emits a numeric manifest with NO source identifiers.
The actual inference runner is separate and requires a licensed positive CT.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import zipfile

PUBLISHER_SOURCE = "https://github.com/dbouget/ct_mediastinal_structures_segmentation/blob/master/setup.py"
PUBLISHER_GOOGLE_DRIVE_ID = "1DBIl8JyXEo6YdM9uNyo3vrv5T2WsYSXT"
PUBLISHER_ARCHIVE_MD5 = "434775bebd64910e01f4198eab251666"
MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_UNCOMPRESSED_BYTES = 4 * 1024**3
MAX_SINGLE_BYTES = 2 * 1024**3
ALLOWED_SUFFIXES = (".h5", ".hdf5", ".hd5", ".hdf", ".ckpt")
ALLOWED_DIRECTORIES = ("UNet-SW32", "AGUNet", "CT_Lungs", "AGUNet-APG")

def digest_file(path: Path, method: str) -> str:
    digest = hashlib.new(method)
    with path.open("rb") as inp:
        while piece := inp.read(1024 * 1024):
            digest.update(piece)
    return digest.hexdigest()

def evaluate_checkpoint_archive(path: Path) -> dict:
    if not path.is_file() or path.stat().st_size == 0 or path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("publisher_archive_missing_or_exceeds_2GiB")
    actual_md5 = digest_file(path, "md5")
    if actual_md5 != PUBLISHER_ARCHIVE_MD5:
        raise ValueError("publisher_original_archive_md5_mismatch")
    checkpoint_files = []
    total = 0
    with zipfile.ZipFile(path) as archive:
        if len(archive.infolist()) > 2000:
            raise ValueError("too_many_archive_members")
        for info in archive.infolist():
            name = PurePosixPath(info.filename)
            parts = name.parts
            if name.is_absolute() or ".." in parts or "\\" in info.filename:
                raise ValueError("untrusted_archive_member_path")
            if info.is_dir():
                continue
            if info.flag_bits & 1:
                raise ValueError("password_protected_weights_not_allowed")
            # Unix symlink or unsafe special file
            mode = (info.external_attr >> 16) & 0o170000
            if mode not in (0, 0o100000):
                raise ValueError("unsupported_file_type_in_weights")
            if info.file_size < 0 or info.file_size > MAX_SINGLE_BYTES:
                raise ValueError("oversized_model_payload")
            total += info.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise ValueError("oversized_uncompressed_archive")
            if name.name.lower().endswith(ALLOWED_SUFFIXES):
                checkpoint_files.append((info, name))
        if not checkpoint_files:
            raise ValueError("publisher_archive_has_no_checkpoint")
        models = []
        for info, name in checkpoint_files:
            parent = set(name.parts)
            model = next((kind for kind in ALLOWED_DIRECTORIES if kind in parent), None)
            if model is None:
                raise ValueError("unrecognized_model_path_in_publisher_archive")
            sha = hashlib.sha256()
            bytes_seen = 0
            with archive.open(info) as inp:
                while chunk := inp.read(1024 * 1024):
                    sha.update(chunk)
                    bytes_seen += len(chunk)
            if bytes_seen != info.file_size:
                raise ValueError("truncated_model_file")
            models.append({"model": model, "checkpointSha256": sha.hexdigest(), "bytes": bytes_seen})
    return {"schema": "opus-bouget-official-checkpoint-inspection/v1",
            "status": "original_archive_verified_checkpoints_read_not_executed",
            "publisher": PUBLISHER_SOURCE,
            "archiveMD5": actual_md5,
            "archiveSHA256": digest_file(path, "sha256"),
            "modelCheckpoints": sorted(models, key=lambda x: x["model"]),
            "totalInflatedBytes": total,
            "genuineForwardCompleted": False,
            "positiveCTCaseChecked": False,
            "expertMaskMetricsAvailable": False,
            "clinicalValidation": False,
            "patientCloudTransfer": False}

def download_publisher_archive(destination: Path):
    if destination.exists():
        return
    # External download must be opt-in and uses a pinned public publisher ID.
    # Import only here: no network call when verifying a local archive.
    import gdown
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".partial")
    try:
        url = "https://drive.google.com/uc?id=" + PUBLISHER_GOOGLE_DRIVE_ID
        result = gdown.download(url, str(temporary), quiet=False, fuzzy=True)
        if not result or not temporary.is_file():
            raise RuntimeError("publisher_GDrive_weights_unavailable")
        if temporary.stat().st_size > MAX_ARCHIVE_BYTES:
            raise RuntimeError("publisher_weights_over_max_size")
        if digest_file(temporary, "md5") != PUBLISHER_ARCHIVE_MD5:
            raise RuntimeError("downloaded_archive_failed_original_publisher_MD5")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("--archive", type=Path, required=True)
    cli.add_argument("--manifest", type=Path, required=True)
    cli.add_argument("--fetch-official", action="store_true")
    args = cli.parse_args()
    try:
        if args.fetch_official:
            download_publisher_archive(args.archive)
        report = evaluate_checkpoint_archive(args.archive)
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        print("Official weight checkpoint verification complete. Forward NOT RUN.")
        print(json.dumps({"archiveSHA256":report["archiveSHA256"],
              "models":[m["model"] for m in report["modelCheckpoints"]]}))
    except Exception as exc:
        print("CHECKPOINT_PREFLIGHT_FAILED: " + str(exc), file=sys.stderr)
        raise SystemExit(2)
if __name__ == "__main__":
    main()
