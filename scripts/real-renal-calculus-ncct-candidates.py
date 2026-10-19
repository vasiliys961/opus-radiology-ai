#!/usr/bin/env python3
"""Source-bound kidney-calculus *candidate* extraction on licensed public noncontrast CT.

Consumes genuine pretrained TotalSegmentator left/right kidney masks provided offline.
HU thresholding is not a trained stone detector or a clinical diagnosis.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

SCHEMA = "opus-kidney-calculus-ncct-candidates/v1"
MAX_BYTES = 800 * 1024 ** 2
MAX_VOXELS = 512 * 512 * 500
PUBLISHER = "https://github.com/wasserth/TotalSegmentator/tree/v2.18.0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_source(path: Path):
    if (path.is_symlink() or not path.is_file() or
        not 256 <= path.stat().st_size <= MAX_BYTES):
        raise ValueError("unavailable_or_unbounded_public_nifti")


def validate_geometry(shape, affine):
    import numpy as np
    if len(shape) != 3 or min(shape) < 16 or math.prod(shape) > MAX_VOXELS:
        raise ValueError("invalid_or_unbounded_original_CT")
    a = np.asarray(affine, dtype=np.float64)
    if a.shape != (4, 4) or not np.isfinite(a).all() or not np.allclose(a[3], [0, 0, 0, 1]):
        raise ValueError("invalid_source_affine")
    lengths = np.linalg.norm(a[:3, :3], axis=0)
    # Thin enough to support small-calcification localisation, but no M1 8GB claim.
    if np.any(lengths < .2) or np.any(lengths > 3.01):
        raise ValueError("unsupported_source_CT_resolution")
    volume = abs(float(np.linalg.det(a[:3, :3])))
    if volume < .02 or volume > 28:
        raise ValueError("unusable_voxel_volume")
    norms = a[:3, :3] / lengths
    if max(abs(np.dot(norms[:, i], norms[:, j])) for i, j in ((0, 1), (0, 2), (1, 2))) > .02:
        raise ValueError("sheared_source_affine_requires_review")
    return a, volume, [float(x) for x in lengths]


def candidates(hu, kidney_masks, affine, threshold_hu=130, min_volume_mm3=2, max_count=256):
    import numpy as np
    from scipy import ndimage
    ct = np.asarray(hu)
    if ct.ndim != 3 or not np.issubdtype(ct.dtype, np.number) or np.iscomplexobj(ct):
        raise ValueError("native_HU_CT_required")
    a, voxel_mm3, spacing = validate_geometry(ct.shape, affine)
    if not isinstance(kidney_masks, dict) or set(kidney_masks) != {"left", "right"}:
        raise ValueError("both_pretrained_kidney_masks_required")
    if not (isinstance(threshold_hu, (float, int)) and 120 <= threshold_hu <= 250 and
            isinstance(min_volume_mm3, (float, int)) and 0 < min_volume_mm3 <= 100):
        raise ValueError("unbounded_or_unvalidated_threshold")
    masks = {}
    for side in ("left", "right"):
        mask = np.asarray(kidney_masks[side])
        if mask.shape != ct.shape or mask.dtype.kind not in "biu" or not np.isin(mask, (0, 1)).all():
            raise ValueError("invalid_native_kidney_binary_mask")
        if not np.any(mask):
            raise ValueError("missing_kidney_is_not_negative_study")
        masks[side] = mask.astype(bool, copy=False)
    if np.any(masks["left"] & masks["right"]):
        raise ValueError("overlapping_kidney_anatomy_must_be_reviewed")
    if not np.isfinite(ct[masks["left"] | masks["right"]]).all():
        raise ValueError("nonfinite_source_HU")
    # Raw pixel data without RescaleIntercept may produce plausible-looking false absences.
    medians = [float(np.median(ct[masks[k]])) for k in ("left", "right")]
    if not all(-50 <= value <= 160 for value in medians):
        raise ValueError("uncalibrated_or_contrast_enhanced_kidney_HU")
    detections = []
    coverage = {}
    for side in ("left", "right"):
        roi = masks[side]
        voxel_count = int(np.count_nonzero(roi))
        if voxel_count * voxel_mm3 < 5000:
            raise ValueError("partial_or_mislabeled_kidney_mask")
        bright = roi & (ct >= threshold_hu)
        # Strict 6-neighbour connectivity to avoid merging nearby independent calcifications.
        labels, n = ndimage.label(bright, structure=ndimage.generate_binary_structure(3, 1))
        volumes = np.bincount(labels.ravel())
        objects = ndimage.find_objects(labels)
        kidney_count = 0
        for ident in range(1, n + 1):
            count = int(volumes[ident])
            if count * voxel_mm3 < min_volume_mm3:
                continue
            region = objects[ident - 1]
            if region is None:
                continue
            offset = [int(s.start) for s in region]
            local = labels[region] == ident
            local_coords = np.column_stack(np.where(local))
            center_ijk = local_coords.mean(axis=0) + offset
            bounds = [[int(s.start), int(s.stop - 1)] for s in region]
            world = (a @ np.array([*center_ijk, 1]))[:3]
            calc_hu = ct[region][local]
            eq_diameter = 2 * ((3 * count * voxel_mm3) / (4 * math.pi)) ** (1 / 3)
            bbox_dims_mm = [(b[1] - b[0] + 1) * s for b, s in zip(bounds, spacing)]
            detections.append({
                "anatomyMaskSide": side,
                "sourceVoxelBox": bounds,
                "sourceCentroidIJK": [round(float(v), 3) for v in center_ijk],
                "centroidWorldRASmm": [round(float(v), 3) for v in world],
                "candidateVolumeMm3": round(count * voxel_mm3, 3),
                "equivalentSphereDiameterMm": round(eq_diameter, 3),
                "voxelBoxDimensionsMmNotCalipers": [round(float(v), 3) for v in bbox_dims_mm],
                "voxelCount": count,
                "maxCandidateHU": round(float(calc_hu.max()), 2),
                "meanCandidateHU": round(float(calc_hu.mean()), 2),
                "stoneDiagnosisProven": False,
            })
            kidney_count += 1
            if len(detections) > max_count:
                raise ValueError("excessive_calcium_candidates_not_reportable")
        coverage[side] = {
            "segmentationVoxelCount": voxel_count,
            "modelMaskVolumeMl": round(voxel_count * voxel_mm3 / 1000, 2),
            "denseComponentCandidateCount": kidney_count
        }
    return detections, coverage


def evidence(found, coverage, source_sha, left_sha, right_sha, source_license, source_url, threshold):
    for digest in (source_sha, left_sha, right_sha):
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise ValueError("source_and_two_anatomy_mask_SHA256_required")
    if (source_license not in {"CC0", "CC BY 3.0", "CC BY 4.0"} or
        not source_url.startswith("https://") or len(source_url) > 1024 or
        any(x in source_url for x in ("@", "?", "#"))):
        raise ValueError("licensed_public_deidentified_source_required")
    return {
        "schema": SCHEMA,
        "modality": "NCCT",
        "task": "intrarenal_high_attenuation_renal_stone_candidates_not_diagnoses",
        "publisherSource": PUBLISHER,
        "sourceCTSHA256": source_sha,
        "pretrainedLeftKidneyAnatomyMaskSHA256": left_sha,
        "pretrainedRightKidneyAnatomyMaskSHA256": right_sha,
        "sourcePublicURL": source_url,
        "sourceLicense": source_license,
        "densityThresholdHU": threshold,
        "kidneyCoverage": coverage,
        "numberOfCandidateComponents": len(found),
        "candidateComponents": found,
        "sourceNativeHUAndNoncontrastProtocolOperatorAttested": True,
        "sourceToAllMasksPhysicalGridMatched": True,
        "trainedAnatomyModelExecutedByThisAdapter": False,
        "pretrainedWeightsVerifiedByThisAdapter": False,
        "stoneSpecificPretrainedDetector": False,
        "ureterEvaluated": False,
        "vascularCalcificationExcluded": False,
        "outsideKidneyPelvisEvaluated": False,
        "definitiveDiagnosis": None,
        "absenceOfStonesEstablished": False,
        "clinicalSensitivityOrSpecificity": None,
        "researchOnly": True,
        "patientUseAllowed": False,
        "limitations": [
            "Kidney anatomy masks must be from genuine TotalSegmentator pretrained inference, verified separately.",
            "Requires licensed public thin-section original HU noncontrast CT; no patient, cloud or LLM.",
            "A high-HU connected component inside kidney segmentation is a candidate, not a proven stone.",
            "Vascular calcification, artifact, contrast or collecting-system anatomy can mimic stones.",
            "Ureter and renal pelvic candidates outside segmented kidney are NOT examined.",
            "Thin slices and expert CT review required; absence of candidates is not negative diagnosis.",
            "No real positive case inference, model checkpoint SHA or expert benchmark for this adapter yet."
        ],
    }


def run(ct_path: Path, left_path: Path, right_path: Path, out_path: Path,
        source_license: str, source_url: str, threshold: int):
    import nibabel as nib
    import numpy as np
    if out_path.exists() or out_path.is_symlink() or out_path.suffix != ".json" or not out_path.parent.is_dir():
        raise ValueError("new_numeric_only_JSON_destination_required")
    for path in (ct_path, left_path, right_path):
        require_source(path)
    ct = nib.load(str(ct_path))
    left = nib.load(str(left_path))
    right = nib.load(str(right_path))
    validate_geometry(ct.shape, ct.affine)
    for img in (left, right):
        if (img.shape != ct.shape or img.ndim != 3 or
            img.header.get_xyzt_units()[0] != "mm" or
            not np.allclose(img.affine, ct.affine, atol=1e-3, rtol=0) or
            img.header.get_data_dtype().kind not in "biu"):
            raise ValueError("pretrained_kidney_mask_not_on_original_source_grid")
    if ct.header.get_xyzt_units()[0] != "mm":
        raise ValueError("source_CT_physical_mm_required")
    found, coverage = candidates(np.asanyarray(ct.dataobj),
                                 {"left": np.asanyarray(left.dataobj),
                                  "right": np.asanyarray(right.dataobj)},
                                 ct.affine, threshold_hu=threshold)
    doc = evidence(found, coverage, sha256(ct_path), sha256(left_path), sha256(right_path),
                   source_license, source_url, threshold)
    out_path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return doc


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--kidney-left", type=Path, required=True)
    p.add_argument("--kidney-right", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--source-license", required=True)
    p.add_argument("--source-url", required=True)
    p.add_argument("--candidate-hu-threshold", type=int, default=130)
    p.add_argument("--licensed-deidentified-public-NCCT-confirmed", action="store_true")
    args = p.parse_args()
    if not args.licensed_deidentified_public_NCCT_confirmed:
        p.error("Real patients forbidden: licensed deidentified public NCCT + original HU require verification")
    doc = run(args.ct, args.kidney_left, args.kidney_right,
              args.output, args.source_license, args.source_url, args.candidate_hu_threshold)
    print(json.dumps({"schema": SCHEMA, "candidates": doc["numberOfCandidateComponents"],
                      "notClinicalDiagnosis": True}))


if __name__ == "__main__":
    main()
