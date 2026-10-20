#!/usr/bin/env python3
"""Research-only opportunistic lumbar vertebral CT attenuation (NOT DXA/T-score).

Uses existing licensed TotalSegmentator spine masks on a source-hash-bound
true-HU, noncontrast CT. Central eroded ROI may still contain bone cortex,
endplates or posterior elements: never interpret threshold as osteoporosis.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

VERTEBRAE = tuple("L"+str(n) for n in range(1, 6))
MAX_BYTES = 750 * 1024**2
MAX_VOXELS = 512*512*500


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024*1024), b""):
            h.update(part)
    return h.hexdigest()


def load_img(path):
    import nibabel as nib
    import numpy as np
    if path.is_symlink() or not path.is_file() or not 200 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("missing_or_oversized_source")
    vol = nib.load(str(path))
    if len(vol.shape) != 3 or np.prod(vol.shape, dtype=np.int64) > MAX_VOXELS:
        raise ValueError("unsupported_volume_dimensions")
    a = vol.affine
    if not np.isfinite(a).all() or not np.allclose(a[3, :], (0, 0, 0, 1)):
        raise ValueError("invalid_native_affine")
    mm = np.linalg.norm(a[:3, :3], axis=0)
    if (np.any(mm < .2) or np.any(mm > 4) or
            abs(a[2, 2]/mm[2]) < .98 or
            abs(np.dot(a[:3, 0], a[:3, 1])) > .02*mm[0]*mm[1]):
        raise ValueError("nonaxial_or_incompatible_CT_spacing")
    return vol, mm


def measure_one(ct, mm, mask_file, level):
    import numpy as np
    from scipy.ndimage import distance_transform_edt
    m, _ = load_img(mask_file)
    if m.shape != ct.shape or not np.allclose(m.affine, ct.affine, rtol=0, atol=.02):
        raise ValueError("original_CT_mask_geometry_mismatch")
    if m.get_data_dtype().kind not in "biu":
        raise ValueError("mask_is_not_integer")
    # No 3D full-float conversion; source and mask read in bounded z-slabs.
    occupied = []
    for k in range(ct.shape[2]):
        plane = np.asarray(m.dataobj[:, :, k])
        if not np.isin(plane, (0, 1)).all():
            raise ValueError("nonbinary_vertebra_mask")
        if np.count_nonzero(plane) >= 16:
            occupied.append(k)
    if len(occupied) < 5:
        raise ValueError("vertebra_absent_or_incomplete")
    # Discard superior/inferior fourth to reduce endplate partial volume.
    central = occupied[len(occupied)//4:len(occupied)-(len(occupied)//4)]
    if len(central) < 3:
        raise ValueError("too_few_central_vertebral_slices")
    values = []
    eroded_slices = 0
    rejected_nonfinite = 0
    for k in central:
        mask = np.asarray(m.dataobj[:, :, k]) == 1
        # Interior 4-mm distance to projected mask edge; this is a RESEARCH ROI
        # and has not been validated as trabecular-only vertebral body.
        roi = distance_transform_edt(mask, sampling=(mm[0], mm[1])) >= 4.
        if not roi.any():
            continue
        ct_plane = np.asarray(ct.dataobj[:, :, k], dtype=np.float32)
        v = ct_plane[roi]
        if not np.isfinite(v).all():
            rejected_nonfinite += int(np.count_nonzero(~np.isfinite(v)))
            raise ValueError("nonfinite_original_CT_HU")
        if np.any(v < -1200) or np.any(v > 6500):
            raise ValueError("implausible_original_HU_intensities")
        values.append(v)
        eroded_slices += 1
    if not values:
        raise ValueError("no_verified_interior_ROI")
    data = np.concatenate(values)
    if data.size < 80:
        raise ValueError("inadequate_vertebral_trabecular_sampling")
    return {
        "vertebralLevel": level, "nativeSourceMaskSHA256": digest(mask_file),
        "originalCTNativeSliceRangeInclusive": [int(central[0]), int(central[-1])],
        "sourceCentralErodedRoiSlices": eroded_slices,
        "sourceCentralRoiVoxelCount": int(data.size),
        "attenuationHU": {"median": round(float(np.median(data)), 2),
                          "mean": round(float(np.mean(data)), 2),
                          "p10": round(float(np.percentile(data, 10)), 2),
                          "p90": round(float(np.percentile(data, 90)), 2),
                          "standardDeviation": round(float(np.std(data)), 2)},
        "noVertebralBodyOnlyROIProof": True, "originalDICOMRescaleVerifiedByOperatorOnly": True,
        "boneMineralDensityGcm2": None, "DXATscore": None,
        "osteoporosisDiagnosis": None, "osteopeniaDiagnosis": None,
        "fractureDiagnosis": None, "noCalibrationOrIndependentReference": True,
    }


def evaluate(source, pairs, sha, url, license_):
    if not url.startswith("https://") or not license_ or len(sha) != 64:
        raise ValueError("source_license_and_hash_required")
    ct, mm = load_img(source)
    if digest(source) != sha.lower():
        raise ValueError("source_CT_digest_mismatch")
    if not pairs:
        raise ValueError("no_lumbar_anatomy_masks")
    out = {}
    for level, path in pairs:
        if level not in VERTEBRAE or level in out:
            raise ValueError("unsupported_or_duplicate_lumbar_level")
        out[level] = measure_one(ct, mm, path, level)
    return {"schema": "opus-vertebral-opportunistic-native-CT-HU/v1",
            "originalSourceCTSHA256": sha.lower(), "licensedSourceURL": url,
            "licensedSourceTerms": license_, "measures": out,
            "HUAndNoncontrastProtocolAreOperatorAttestedNotIndependentlyAudited": True,
            "genuineModelInferencePerformed": False,
            "noPatientCloudTransfer": True,
            "clinicallyValidated": False, "noOsteoporosisOrOsteopeniaDiagnosis": True}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--ct-sha256", required=True)
    p.add_argument("--level-mask", action="append", required=True,
                   help="L1=/source-grid/vertebrae_L1.nii.gz")
    p.add_argument("--public-source-url", required=True)
    p.add_argument("--public-source-license", required=True)
    p.add_argument("--approved-public-research", action="store_true")
    p.add_argument("--noncontrast-protocol-confirmed", action="store_true")
    p.add_argument("--original-HU-calibration-confirmed", action="store_true")
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if not (a.approved_public_research and a.noncontrast_protocol_confirmed
            and a.original_HU_calibration_confirmed):
        p.error("licensed_public_noncontrast_original_HU_confirmation_required")
    levels = []
    for item in a.level_mask:
        level, sep, filename = item.partition("=")
        if not sep or not filename:
            p.error("--level-mask must be L1=path")
        levels.append((level, Path(filename)))
    report = evaluate(a.ct, levels, a.ct_sha256, a.public_source_url,
                      a.public_source_license)
    if a.output.is_symlink() or a.output.exists():
        p.error("new_report_destination_required")
    a.output.parent.mkdir(exist_ok=True, parents=True)
    a.output.write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps({"measuredLevels": sorted(report["measures"]),
                      "originalCTSHA256": report["originalSourceCTSHA256"],
                      "DXATscore": None, "clinicallyValidated": False}))


if __name__ == "__main__":
    main()
