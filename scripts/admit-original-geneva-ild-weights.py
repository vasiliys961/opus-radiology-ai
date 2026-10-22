#!/usr/bin/env python3
"""Audit ORIGINAL publisher Geneva HRCT ILD segmentation checkpoint bytes.

Research-only, download opt-in; prevents a Drive landing page masquerading as
trained weights. Never loads a pickle, never touches any patient imaging.
No inference or license authorization is claimed.
"""
import argparse
import hashlib
import json
from pathlib import Path

PUBLISHER = "DhruvaRajwade/ILD-Segmentation-And-Classification-DL"
MODELS = {
    "UNET": "1mrTg95Bm0SSlLEzZphUu3wYFkYE7G-vD",
    "Attn_UNET": "1ZkiMf9-5Z861D2xdqpABC3-2li9mCjPw",
    "R2_UNET": "1AX8ABi2fGhylJFTLaKoWArSZXG_O35VS",
    "Attn_R2_UNET": "1ZTFNYRzSsz8XRPVyZ27lRU_zu5VwSaKZ",
}
MAX_BYTES = 2 * 1024**3
MIN_BYTES = 1_000_000


def audit_file(path):
    if not path.is_file() or path.stat().st_size < MIN_BYTES or path.stat().st_size > MAX_BYTES:
        raise ValueError("checkpoint_absent_or_unexpected_size")
    h = hashlib.sha256()
    beginning = b""
    with path.open("rb") as f:
        beginning = f.read(512)
        h.update(beginning)
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    text = beginning.lstrip().lower()
    if any(x in text for x in (b"<html", b"<!doctype", b"access denied", b"git-lfs.github.com/spec")):
        raise ValueError("download_is_not_original_model_weights")
    return {"bytes": path.stat().st_size, "observedSha256": h.hexdigest(),
            "publisherSha256Available": False, "trustedForAutomaticClinicalRouting": False}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", choices=sorted(MODELS), required=True)
    p.add_argument("--file", type=Path, help="original publisher file already downloaded")
    p.add_argument("--download", action="store_true", help="opt-in research download via gdown")
    p.add_argument("--output", type=Path, required=True)
    args = p.parse_args()
    if args.download and args.file:
        p.error("Choose either --download or --file")
    if args.download:
        import gdown
        path = args.output.with_suffix(".weights")
        if path.exists():
            raise ValueError("refuse_overwrite_of_existing_model_asset")
        received = gdown.download(id=MODELS[args.model], output=str(path), quiet=True, fuzzy=False)
        if not received:
            raise RuntimeError("publisher_Google_Drive_asset_not_publicly_available")
    elif args.file:
        path = args.file
    else:
        p.error("Select --file or explicit --download")
    result = audit_file(path)
    report = {
        "schema": "opus-geneva-ild-original-checkpoint-admission/v1",
        "publisherRepository": PUBLISHER, "architecture": args.model,
        "publisherDriveFileId": MODELS[args.model], **result,
        "trueTrainedForward": False,
        "patientDataTransferred": False, "clinicalValidation": False,
        "rights": "Geneva HUG-ILD requires research agreement; access/derivative-model rights unverified",
        "caution": "Dataset uses multitype annotated ILD patterns; class ordering and checkpoint architecture must be independently established before prediction",
    }
    if args.output.exists():
        raise ValueError("report_must_be_a_new_file")
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
