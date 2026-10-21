#!/usr/bin/env python3
"""Prepare original PI-CAI MHA MRI channels for the AutoMSC research executor.

Resamples in physical space only; this does NOT replace image registration.
Fails closed if channel field-of-view or centers are implausibly different.
Requires separately authorized de-identified local input images.
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import SimpleITK as sitk


def digest(p):
    h = hashlib.sha256()
    with Path(p).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def center(image):
    index = [(n - 1) / 2 for n in image.GetSize()]
    return np.asarray(image.TransformContinuousIndexToPhysicalPoint(index), dtype=float)


def corners_in_reference(moving, reference):
    sizes = moving.GetSize()
    corners = []
    for x in (0, sizes[0] - 1):
        for y in (0, sizes[1] - 1):
            for z in (0, sizes[2] - 1):
                point = moving.TransformIndexToPhysicalPoint((x, y, z))
                corners.append(reference.TransformPhysicalPointToContinuousIndex(point))
    return np.asarray(corners)


def convert(args):
    paths = {"t2w": args.t2w, "adc": args.adc, "hbv": args.hbv}
    if args.out.exists() and any(args.out.iterdir()):
        raise ValueError("Output must be a new empty folder; stale results prohibited")
    for p in paths.values():
        if not p.is_file():
            raise FileNotFoundError(p)
    images = {name: sitk.ReadImage(str(p), sitk.sitkFloat32) for name, p in paths.items()}
    for name, img in images.items():
        if img.GetDimension() != 3 or min(img.GetSize()) < 2:
            raise ValueError(f"{name}: expected nonempty 3D MR series")
        if min(img.GetSpacing()) <= 0:
            raise ValueError(f"{name}: invalid spacing")
    reference = images["t2w"]
    metrics = {}
    for name in ("adc", "hbv"):
        moving = images[name]
        displacement = float(np.linalg.norm(center(moving) - center(reference)))
        corners = corners_in_reference(moving, reference)
        # Conservative physical-space overlap check, NOT proof of registration.
        reference_max = np.asarray(reference.GetSize(), dtype=float) - 1
        overlap = np.maximum(0, np.minimum(corners.max(axis=0), reference_max) -
                              np.maximum(corners.min(axis=0), 0))
        coverage = float(np.prod(overlap / np.maximum(reference_max, 1)))
        metrics[name] = {"centerDistanceMm": displacement,
                         "referenceBoundingBoxCoverageApprox": coverage}
        if displacement > args.max_center_distance_mm or coverage < args.min_coverage:
            raise ValueError(f"{name}: physical fields of view inconsistent; reviewed registration required")
    args.out.mkdir(parents=True, exist_ok=True)
    filenames = {}
    for name in ("t2w", "adc", "hbv"):
        img = images[name]
        if name != "t2w":
            img = sitk.Resample(img, reference, sitk.Transform(3, sitk.sitkIdentity),
                                sitk.sitkLinear, 0.0, sitk.sitkFloat32)
        destination = args.out / f"{name}.nii.gz"
        sitk.WriteImage(img, str(destination), useCompression=True)
        filenames[name] = {"output": str(destination), "sha256": digest(destination),
                           "sourceSha256": digest(paths[name])}
    report = {
        "schema": "opus-picai-physical-grid-preparation/v1",
        "sourceType": "original PI-CAI MHA research MRI",
        "channelOrder": ["t2w", "adc", "hbv"], "reference": "t2w",
        "geometry": {"size": reference.GetSize(), "spacingMm": reference.GetSpacing(),
                     "origin": reference.GetOrigin(), "direction": reference.GetDirection()},
        "coverage": metrics, "files": filenames,
        "physicalResamplingOnly": True, "registrationVerified": False,
        "clinicalValidation": False, "expertReviewRequired": True
    }
    (args.out / "preparation.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for k in ("t2w", "adc", "hbv", "out"):
        p.add_argument("--" + k, type=Path, required=True)
    p.add_argument("--max-center-distance-mm", type=float, default=8.0)
    p.add_argument("--min-coverage", type=float, default=0.45)
    args = p.parse_args()
    if not (0 < args.min_coverage <= 1) or args.max_center_distance_mm <= 0:
        p.error("Coverage must be 0..1 and max-center-distance must be positive")
    convert(args)
