#!/usr/bin/env python3
"""Fetch authoritative Kaggle metadata for the Carles Task998 CT checkpoint.

This tool does NOT download model weights, patient studies, images or masks.
It must never silently substitute Task999 PET weights for Task998 CT.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

MODEL = "dejankuhn/ct-lung-tumor-segmentation-model"
URL = "https://www.kaggle.com/api/v1/models/view/" + MODEL
MAX_METADATA = 2 * 1024 * 1024


def parse_metadata(payload: bytes) -> dict:
    if len(payload) > MAX_METADATA:
        raise ValueError("authoritative_kaggle_metadata_oversized")
    data = json.loads(payload)
    if not isinstance(data, dict):
        raise ValueError("invalid_kaggle_model_metadata")
    # Kaggle API changed model/variation naming over time. Preserve only
    # schema-known public fields, never guess a variation/version.
    variations = []
    for name in ("modelInstances", "instances", "variations", "modelVariations"):
        value = data.get(name)
        if not isinstance(value, list):
            continue
        for item in value:
            if not isinstance(item, dict):
                continue
            framework = item.get("framework") or item.get("frameworkSlug")
            variant = item.get("instanceSlug") or item.get("variationSlug") or item.get("slug")
            if framework and variant:
                entry = {"framework": str(framework), "variant": str(variant),
                         "version": item.get("currentVersionNumber")}
                if entry not in variations:
                    variations.append(entry)
    return {"schema": "opus-carles-kaggle-public-CT-provenance/v1",
            "authorRepository": "https://github.com/MonCarFa/PET-CT-Lung-Segmentation-Models",
            "officialCTModel": MODEL, "expectedNnUNetTask": "Task998_LungCTSegmentation",
            "petTaskExcluded": "Task999_LungPETSegmentation",
            "declaredModelLicense": data.get("licenseName"),
            "publicMetadataSHA256": hashlib.sha256(payload).hexdigest(),
            "variations": variations,
            "modelArchiveDownloaded": False, "originalWeightsVerified": False,
            "inferenceCompleted": False, "clinicalValidation": False}


def fetch_metadata() -> bytes:
    request = urllib.request.Request(URL, headers={
        "Accept": "application/json", "User-Agent": "Opus-Radiology-research-provenance/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        if response.status != 200:
            raise ValueError("kaggle_original_model_metadata_not_public")
        data = response.read(MAX_METADATA + 1)
    if len(data) > MAX_METADATA:
        raise ValueError("authoritative_kaggle_metadata_oversized")
    return data


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--input-fixture", type=Path,
                   help="local JSON contract test only, NEVER authentic Kaggle evidence")
    args = p.parse_args()
    payload = args.input_fixture.read_bytes() if args.input_fixture else fetch_metadata()
    report = parse_metadata(payload)
    if args.input_fixture:
        report.update({"modelArchiveDownloaded": False, "fixtureOnly": True,
                       "originalWeightsVerified": False})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"metadataRetrieved": not bool(args.input_fixture),
                      "variations": report["variations"], "license": report["declaredModelLicense"],
                      "originalWeightsVerified": False}))


if __name__ == "__main__":
    main()
