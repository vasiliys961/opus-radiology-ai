#!/usr/bin/env python3
"""Choose ONE real source CT / original expert NIfTI pair from a local Zenodo archive.

Never fabricates a mask or links cases by image similarity. Requires a shared
subject identifier/stem AND same physical native grid. No uploads. Dataset is
already downloaded and unpacked by an authorized, bounded GitHub research job.
Prints no filenames, case IDs, patient identifiers, voxels or archive paths.
"""
from __future__ import annotations

import argparse
import hashlib
import math
import os
from pathlib import Path
import re
import sys

MAX_FILES = 3000
MAX_SIZE = 512 * 1024 * 1024
MAX_VOXELS = 512 * 512 * 400
NIFTI_ENDINGS = (".nii", ".nii.gz")


def no_identifier_output(message: str):
    print(message, file=sys.stderr)


def is_nifti(p: Path) -> bool:
    return p.name.lower().endswith(NIFTI_ENDINGS)


def cleaned_stem(p: Path) -> str:
    n = p.name.lower()
    if n.endswith(".nii.gz"):
        n = n[:-7]
    elif n.endswith(".nii"):
        n = n[:-4]
    return n


def subject_keys(p: Path) -> set[str]:
    name = cleaned_stem(p)
    tokens = re.findall(r"[a-z]+|\d+", name)
    removed = {
        "ct", "image", "images", "img", "scan", "volume", "vol",
        "mask", "masks", "label", "labels", "expert", "annotation",
        "seg", "segmentation", "bleeding", "blood", "hemorrhage",
        "sah", "brain", "skullstrip", "skull", "normalized",
        "normalised", "final", "post", "pre", "resampled", "resample",
        "nii", "nii.gz", "patient", "subject", "case", "study", "series",
    }
    return {v for v in tokens if v not in removed and len(v) >= 3}


def same_subject(a: Path, b: Path) -> bool:
    stem_a, stem_b = cleaned_stem(a), cleaned_stem(b)
    if stem_a == stem_b:
        return True
    keys_a, keys_b = subject_keys(a), subject_keys(b)
    digits_a = {x for x in keys_a if x.isdigit()}
    digits_b = {x for x in keys_b if x.isdigit()}
    if digits_a or digits_b:
        return bool(digits_a & digits_b)
    return any(len(x) >= 6 and x.isalpha() for x in keys_a & keys_b)


def describe(p: Path):
    import nibabel as nib
    import numpy as np

    if p.is_symlink() or not p.is_file() or p.stat().st_size > MAX_SIZE \
            or p.stat().st_size <= 0 or not is_nifti(p):
        return None
    nii = nib.load(str(p))
    if nii.ndim != 3 or math.prod(nii.shape) > MAX_VOXELS \
            or min(nii.shape) < 16 or max(nii.shape) > 512:
        return None
    affine = nii.affine
    if (nii.header.get_xyzt_units()[0] != "mm"
            or int(nii.header["sform_code"]) <= 0
            or not np.all(np.isfinite(affine))
            or not np.isfinite(np.linalg.det(affine[:3, :3]))
            or abs(np.linalg.det(affine[:3, :3])) < 0.001):
        return None
    if int(nii.header["qform_code"]) > 0 and not np.allclose(
            nii.get_qform(), affine, rtol=0, atol=0.05):
        return None
    sampled = []
    for k in sorted({0, nii.shape[2] // 2, nii.shape[2] - 1}):
        v = np.asarray(nii.dataobj[:, :, k])
        if not np.all(np.isfinite(v)):
            return None
        sampled.append(v[::max(1, v.shape[0] // 64), ::max(1, v.shape[1] // 64)])
    vals = np.unique(np.concatenate([x.ravel() for x in sampled]))
    binary_like = len(vals) <= 4 and np.all(vals >= 0) and np.all(vals == np.floor(vals))
    hint = bool(re.search(r"(mask|label|seg|ground.truth|expert|annotation|gt)", p.name.lower()))
    is_mask = bool(binary_like or hint) and nii.header.get_data_dtype().kind in "iu"
    return {"path": p, "nii": nii, "mask": is_mask, "shape": nii.shape,
            "affine": affine, "kind": nii.header.get_data_dtype().kind}


def select_public_case(root: Path, slice_count: int):
    import numpy as np

    files = sorted(p for p in root.rglob("*") if is_nifti(p))
    if not files or len(files) > MAX_FILES:
        raise ValueError("bounded_nonempty_public_nifti_collection_required")
    good = []
    for p in files:
        try:
            candidate = describe(p)
        except Exception:
            candidate = None
        if candidate:
            good.append(candidate)
    masks = [c for c in good if c["mask"]]
    images = [c for c in good if not c["mask"]]
    for expert in masks:
        for source in images:
            if not same_subject(source["path"], expert["path"]):
                continue
            if source["shape"] != expert["shape"] or \
                    not np.allclose(source["affine"], expert["affine"], atol=0.05, rtol=0):
                continue
            if source["shape"][2] < slice_count:
                continue
            labelmap = np.asarray(expert["nii"].dataobj)
            # Only a genuine positive binary or 0/1 expert label is accepted.
            if not np.all((labelmap == 0) | (labelmap == 1)):
                continue
            profile = np.count_nonzero(labelmap == 1, axis=(0, 1))
            if not np.any(profile):
                continue
            k = int(np.argmax(profile))
            start = max(0, min(k - slice_count // 2, source["shape"][2] - slice_count))
            if int(profile[start:start + slice_count].sum()) <= 0:
                continue
            return source["path"], expert["path"], start
    raise ValueError("no_unambiguously_named_native_aligned_positive_original_expert_case")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extracted-dir", required=True)
    parser.add_argument("--slice-count", type=int, choices=(16, 32), required=True)
    parser.add_argument("--github-output", required=True)
    args = parser.parse_args()
    root = Path(args.extracted_dir)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("archive_extract_directory_required")
    ct, expert, start = select_public_case(root, args.slice_count)
    for p in (ct, expert):
        if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
            raise ValueError("untrusted_extracted_source_file")
    with open(args.github_output, "a", encoding="utf-8") as out:
        for key, val in (
                ("ct", ct.resolve()), ("expert", expert.resolve()),
                ("ct_sha", hashlib.sha256(ct.read_bytes()).hexdigest()),
                ("expert_sha", hashlib.sha256(expert.read_bytes()).hexdigest()),
                ("start", start)):
            print(f"{key}={val}", file=out)
    print("Found one original paired positive CT/expert 3D NIfTI; only anonymous geometry/provenance passed.",flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Strip archive paths and filenames on GitHub public CI.
        no_identifier_output("Public case selection failed: " + type(error).__name__
                             + " (verify archive layout, geometry and expert labels)")
        sys.exit(2)
