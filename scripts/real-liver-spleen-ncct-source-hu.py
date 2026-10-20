#!/usr/bin/env python3
"""Noncontrast CT liver-vs-spleen HU profile from original anatomical masks.

Descriptive source-native, research only; not an automated liver steatosis,
cirrhosis, fibrosis, portal hypertension or focal-tumor diagnostic model.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

MAX_BYTES = 750 * 1024**2
MAX_VOXELS = 512*512*500
ORGANS = ("liver", "spleen")


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()


def read_image(path):
    import nibabel as nib
    import numpy as np
    if path.is_symlink() or not path.is_file() or not 200 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("invalid_or_unbounded_source_NIfTI")
    img = nib.load(str(path))
    a = img.affine
    if len(img.shape) != 3 or math.prod(img.shape) > MAX_VOXELS:
        raise ValueError("CT_shape_limit")
    mm = np.linalg.norm(a[:3, :3], axis=0)
    if (not np.isfinite(a).all() or not np.allclose(a[3], [0, 0, 0, 1])
            or np.any(mm < .2) or np.any(mm > 4) or
            abs(np.linalg.det(a[:3, :3])) < .008 or
            abs(a[2, 2] / mm[2]) < .98):
        raise ValueError("axial_native_CT_HU_grid_required")
    return img, mm


def organ_roi(ct, mm, mask_path, organ):
    import numpy as np
    from scipy.ndimage import distance_transform_edt
    mask, _ = read_image(mask_path)
    if mask.shape != ct.shape or not np.allclose(
            ct.affine, mask.affine, rtol=0, atol=.02):
        raise ValueError("source_mask_native_grid_mismatch")
    if mask.get_data_dtype().kind not in "biu":
        raise ValueError("noninteger_mask")
    occupied = []
    for k in range(ct.shape[2]):
        p = np.asarray(mask.dataobj[:, :, k])
        if not np.isin(p, (0, 1)).all():
            raise ValueError("mask_not_binary")
        if int(np.count_nonzero(p)) >= 30:
            occupied.append(k)
    if len(occupied) < 5:
        raise ValueError("insufficient_original_organ_coverage")
    # The largest organ-specific 60% central axial region avoids liver dome /
    # hilum/spleen poles; still does NOT remove every vessel or tumor focus.
    trim = max(1, len(occupied)//5)
    chosen = occupied[trim:len(occupied)-trim]
    observed = []
    roi_count = 0
    for k in chosen:
        p = np.asarray(mask.dataobj[:, :, k]) == 1
        inside = distance_transform_edt(p, sampling=(mm[0], mm[1])) >= 5.
        if not inside.any():
            continue
        intens = np.asarray(ct.dataobj[:, :, k], dtype=np.float32)[inside]
        if (not np.isfinite(intens).all() or
                np.any(intens < -1200) or np.any(intens > 6500)):
            raise ValueError("unverified_CT_HU_intensity_range")
        observed.append(intens)
        roi_count += intens.size
    if roi_count < 80:
        raise ValueError("interior_organ_HU_ROI_too_small")
    data = np.concatenate(observed)
    return {
        "sourceMaskSHA256": digest(mask_path), "anatomy": organ,
        "centralAxialSourceSlicesInclusive": [int(chosen[0]), int(chosen[-1])],
        "centralInteriorROIvoxels": int(data.size),
        "erodedInteriorDistanceMm": 5.0,
        "HU": {"median": round(float(np.median(data)), 2),
               "mean": round(float(np.mean(data)), 2),
               "p10": round(float(np.percentile(data, 10)), 2),
               "p90": round(float(np.percentile(data, 90)), 2)},
        "mayStillIncludeVesselsLesionsOrCirrhoticChanges": True,
        "fullOrganCoverageVerified": False,
    }


def evaluate(ct_file, liver_file, spleen_file, ct_sha, source_url, license_):
    if (len(ct_sha) != 64 or any(x not in "0123456789abcdef"
                                  for x in ct_sha.lower()) or
            not source_url.startswith("https://") or not license_.strip()):
        raise ValueError("approved_public_source_metadata_required")
    if digest(ct_file) != ct_sha.lower():
        raise ValueError("original_CT_SHA256_does_not_match")
    ct, mm = read_image(ct_file)
    liver = organ_roi(ct, mm, liver_file, "liver")
    spleen = organ_roi(ct, mm, spleen_file, "spleen")
    difference = round(liver["HU"]["median"] - spleen["HU"]["median"], 2)
    return {
        "schema": "opus-noncontrast-native-CT-liver-spleen-HU/v1",
        "originalCtSHA256": ct_sha.lower(), "publicStudyURL": source_url,
        "sourceLicense": license_, "sourceMedicalHUAndNoncontrastOperatorAttested": True,
        "liver": liver, "spleen": spleen, "liverMinusSpleenMedianHU": difference,
        "qualitativeSteatosisSuggestedByRatio": None,
        "steatosisDiagnosis": None, "cirrhosisDiagnosis": None,
        "fibrosisStage": None, "portalHypertensionDiagnosis": None,
        "genuineTrainedModelForwardPerformedByThisScript": False,
        "clinicallyValidated": False, "patientCloudTransfer": False,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--ct-sha256", required=True)
    p.add_argument("--liver-mask", type=Path, required=True)
    p.add_argument("--spleen-mask", type=Path, required=True)
    p.add_argument("--public-source-url", required=True)
    p.add_argument("--public-source-license", required=True)
    p.add_argument("--approved-public-research", action="store_true")
    p.add_argument("--noncontrast-protocol-confirmed", action="store_true")
    p.add_argument("--original-HU-calibration-confirmed", action="store_true")
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if not (a.approved_public_research and a.noncontrast_protocol_confirmed
            and a.original_HU_calibration_confirmed):
        p.error("noncontrast_original_HU_public_research_only")
    result = evaluate(a.ct, a.liver_mask, a.spleen_mask,
                      a.ct_sha256, a.public_source_url, a.public_source_license)
    if a.output.is_symlink() or a.output.exists():
        p.error("results_must_be_new")
    a.output.parent.mkdir(exist_ok=True, parents=True)
    a.output.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps({"liverMinusSpleenMedianHU": result["liverMinusSpleenMedianHU"],
                      "clinicallyValidated": False, "genuineForward": False}))


if __name__ == "__main__":
    main()
