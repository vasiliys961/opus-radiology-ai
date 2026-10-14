#!/usr/bin/env python3
"""Find a source CT and its ORIGINAL positive expert NIfTI without guessing.

Accept multiple original study naming conventions (including 1-2 digit case
IDs, separate image/mask folders and integer-valued float NIfTI masks).
Always match explicit identifiers AND native 3D shape/physical affine.
Never pair by visual resemblance, order or equal shape alone. Log only
aggregate rejection counts; never CT paths, names, identifiers or voxels.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import math
from pathlib import Path
import re
import sys

MAX_FILES = 3000
MAX_SIZE = 512 * 1024 * 1024
MAX_VOXELS = 512 * 512 * 400
NIFTI_ENDINGS = (".nii", ".nii.gz")
MASK_WORDS = {"mask", "masks", "label", "labels", "gt", "groundtruth",
              "seg", "segment", "segmentation", "segmentations",
              "annotation", "annotations", "expert"}
SCAN_WORDS = {"ct", "cts", "image", "images", "img", "scan", "scans",
              "volume", "vol", "input", "inputs"}
GENERIC_WORDS = MASK_WORDS | SCAN_WORDS | {
    "sah", "brain", "skullstrip", "skull", "normalized",
    "normalised", "final", "post", "pre", "resampled", "resample",
    "nii", "patient", "subject", "case", "study", "series",
    "data", "raw", "rhuh", "hospital", "nifti", "files",
    "subarachnoid", "hemorrhage", "haemorrhage", "bleeding",
}


def is_nifti(p: Path) -> bool:
    return p.name.lower().endswith(NIFTI_ENDINGS)


def cleaned_stem(p: Path) -> str:
    name = p.name.lower()
    return name[:-7] if name.endswith(".nii.gz") else (
        name[:-4] if name.endswith(".nii") else name)


def word_tokens(text: str) -> list[str]:
    return re.findall(r"[a-z]+|\d+", text.lower())


def subject_keys(p: Path) -> set[str]:
    # Only the immediate parent directory may encode the subject.
    # Never use global dataset-root names to infer a match.
    tokens = word_tokens(cleaned_stem(p)) + word_tokens(p.parent.name)
    return {x.lstrip("0") or "0" if x.isdigit() else x
            for x in tokens if x not in GENERIC_WORDS}


def same_subject(a: Path, b: Path) -> bool:
    # Equally named image/mask stems in different modality folders are common.
    # Generic names ('ct', 'mask') never suffice without a case ID.
    stem_a, stem_b = cleaned_stem(a), cleaned_stem(b)
    ids_a, ids_b = subject_keys(a), subject_keys(b)
    if not ids_a or not ids_b:
        return False
    numeric_a = {x for x in ids_a if x.isdigit()}
    numeric_b = {x for x in ids_b if x.isdigit()}
    if numeric_a or numeric_b:
        # Different explicit numerical case IDs must never match only because
        # both files carry a shared timepoint/series number.
        if not numeric_a or not numeric_b:
            return False
        if (numeric_a - numeric_b) or (numeric_b - numeric_a):
            return False
        return True
    if stem_a == stem_b and any(len(x) >= 4 for x in ids_a & ids_b):
        return True
    return any(len(x) >= 6 and x.isalpha() for x in ids_a & ids_b)


def describe(p: Path, reasons: Counter):
    import nibabel as nib
    import numpy as np

    if (p.is_symlink() or not p.is_file()
            or not 0 < p.stat().st_size <= MAX_SIZE):
        reasons["unsafe_size_or_symlink"] += 1
        return None
    try:
        nii = nib.load(str(p))
        if (nii.ndim != 3 or math.prod(nii.shape) > MAX_VOXELS
                or min(nii.shape) < 16 or max(nii.shape) > 512):
            reasons["unsupported_nifti_dimensions"] += 1
            return None
        # Some legitimate public scientific NIfTI volumes preserve a valid
        # qform while leaving sform_code=0. Nibabel uses that qform as affine.
        # Do NOT assume voxel size or a fictitious RAS transform when BOTH
        # codes are missing, or when physical units are unspecified.
        scode = int(nii.header["sform_code"])
        qcode = int(nii.header["qform_code"])
        if (nii.header.get_xyzt_units()[0] != "mm"
                or (scode <= 0 and qcode <= 0)):
            reasons["missing_explicit_mm_sform_or_qform"] += 1
            return None
        reasons["native_sform" if scode > 0 else "native_qform_only"] += 1
        affine = np.asarray(nii.affine)
        if (not np.all(np.isfinite(affine))
                or not np.isfinite(np.linalg.det(affine[:3, :3]))
                or abs(np.linalg.det(affine[:3, :3])) < .001):
            reasons["invalid_affine"] += 1
            return None
        if int(nii.header["qform_code"]) > 0 and not np.allclose(
                nii.get_qform(), affine, atol=.05, rtol=0):
            reasons["conflicting_qform"] += 1
            return None
        kind = nii.header.get_data_dtype().kind
        if kind not in "iuf":
            reasons["unsupported_data_type"] += 1
            return None
        # Filename OR immediate parent can distinguish original source/GT.
        tokens = (set(word_tokens(cleaned_stem(p)))
                  | set(word_tokens(p.parent.name)))
        mask_hint = bool(tokens & MASK_WORDS)
        scan_hint = bool(tokens & SCAN_WORDS)
        sampled = []
        for k in sorted({0, nii.shape[2] // 2, nii.shape[2] - 1}):
            v = np.asarray(nii.dataobj[:, :, k])
            if not np.all(np.isfinite(v)):
                reasons["nonfinite_sample"] += 1
                return None
            sampled.append(v[::max(1, v.shape[0] // 64),
                             ::max(1, v.shape[1] // 64)])
        values = np.unique(np.concatenate([x.ravel() for x in sampled]))
        binary_like = (len(values) <= 4 and np.all(values >= 0)
                       and np.all(values == np.floor(values)))
        if mask_hint and not scan_hint:
            is_mask = True
        elif scan_hint and not mask_hint:
            is_mask = False
        else:
            is_mask = bool(binary_like)
        reasons["valid_mask" if is_mask else "valid_source"] += 1
        return {"path": p, "nii": nii, "mask": is_mask,
                "shape": nii.shape, "affine": affine, "kind": kind}
    except Exception:
        reasons["unreadable_nifti"] += 1
        return None


def select_public_case(root: Path, slice_count: int):
    import numpy as np

    files = sorted(p for p in root.rglob("*") if is_nifti(p))
    stats = Counter(nifti_files=len(files))
    if not files or len(files) > MAX_FILES:
        print("Zenodo pairing summary: " + str(dict(sorted(stats.items()))),
              flush=True)
        raise ValueError("bounded_nonempty_public_nifti_collection_required")
    good = [x for p in files if (x := describe(p, stats)) is not None]
    masks = [c for c in good if c["mask"]]
    images = [c for c in good if not c["mask"]]
    for source in images:
        named = [mask for mask in masks
                 if same_subject(source["path"], mask["path"])]
        if named:
            stats["same_subject_candidates"] += len(named)
        geometric = [mask for mask in named if (
            source["shape"] == mask["shape"]
            and np.allclose(source["affine"], mask["affine"],
                            atol=.05, rtol=0))]
        stats["matching_geometry_pairs"] += len(geometric)
        # Avoid guessing among multiple equally plausible manual annotations.
        if len(geometric) != 1:
            if len(geometric) > 1:
                stats["ambiguous_same_subject_masks"] += 1
            continue
        expert = geometric[0]
        if source["shape"][2] < slice_count:
            stats["too_few_axial_slices"] += 1
            continue
        labelmap = np.asarray(expert["nii"].dataobj)
        # Float32 expert labels are frequent in scientific NIfTI exports.
        # Accept them ONLY if original entire volume is EXACTLY 0 or 1,
        # not rounded/thresholded/interpolated data.
        if (not np.all(np.isfinite(labelmap))
                or not np.all((labelmap == 0) | (labelmap == 1))):
            stats["nonbinary_or_invalid_expert"] += 1
            continue
        profile = np.count_nonzero(labelmap == 1, axis=(0, 1))
        if not np.any(profile):
            stats["blank_expert_mask"] += 1
            continue
        k = int(np.argmax(profile))
        start = max(0, min(k - slice_count // 2,
                           source["shape"][2] - slice_count))
        if int(profile[start:start + slice_count].sum()) <= 0:
            stats["no_expert_positive_in_slab"] += 1
            continue
        # Aggregate counters contain no identifiers, pixel data or filenames.
        stats["paired_positive_original_expert_cases"] += 1
        print("Zenodo pairing summary: " + str(dict(sorted(stats.items()))),
              flush=True)
        return source["path"], expert["path"], start
    print("Zenodo pairing summary: " + str(dict(sorted(stats.items()))),
          flush=True)
    raise ValueError("no_unambiguously_named_native_aligned_positive_original_expert_case")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extracted-dir", required=True)
    parser.add_argument("--slice-count", type=int, choices=(16, 32),
                        required=True)
    parser.add_argument("--github-output", required=True)
    args = parser.parse_args()
    root = Path(args.extracted_dir)
    if root.is_symlink() or not root.is_dir():
        raise ValueError("archive_extract_directory_required")
    ct, expert, start = select_public_case(root, args.slice_count)
    for p in (ct, expert):
        if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
            raise ValueError("untrusted_extracted_source_file")
    # GitHub prints step environment values in public job logs. Mask the
    # individual original CT/GT file paths *before* publishing step outputs.
    # Do not emit untrusted workflow commands containing CR/LF or terminal
    # controls from an archive filename.
    for p in (ct.resolve(), expert.resolve()):
        name = str(p)
        if any(ord(char) < 32 or ord(char) == 127 for char in name):
            raise ValueError("unsafe_original_archive_path")
        print("::add-mask::" + name, flush=True)
    with open(args.github_output, "a", encoding="utf-8") as out:
        for key, val in (
                ("ct", ct.resolve()), ("expert", expert.resolve()),
                ("ct_sha", sha256_file(ct)),
                ("expert_sha", sha256_file(expert)),
                ("start", start)):
            print(f"{key}={val}", file=out)
    print("One verified original subject and expert mask selected privately.",
          flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # The aggregate diagnostic counters already appeared in stdout;
        # no specific source filename, patient number or NIfTI values leak.
        print("Public pairing failed: " + type(error).__name__
              + " (see anonymous candidate counters above)", file=sys.stderr)
        sys.exit(2)
