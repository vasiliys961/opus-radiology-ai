#!/usr/bin/env python3
"""Research-only inspiratory CT low-attenuation densitometry with external R231 mask.

No pretrained model invocation, automatic emphysema/COPD diagnosis or patient mode.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

MAX_VOXELS = 512 * 512 * 600
MAX_BYTES = 750 * 1024 ** 2
SCHEMA = "opus-inspiratory-ct-laa950-research/v1"


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def regions(ct_hu, lungmask, affine, min_lung_ml=700):
    import numpy as np
    ct = np.asarray(ct_hu)
    seg = np.asarray(lungmask)
    if ct.shape != seg.shape or ct.ndim != 3 or min(ct.shape) < 16 or ct.size > MAX_VOXELS:
        raise ValueError("invalid_or_unbounded_native_CT_and_mask")
    if seg.dtype.kind not in "biu" or not np.isin(seg, (0, 1, 2)).all():
        raise ValueError("expected_original_R231_two_lung_labels")
    a = np.asarray(affine, dtype=float)
    if a.shape != (4, 4) or not np.isfinite(a).all() or not np.allclose(a[3], [0, 0, 0, 1]):
        raise ValueError("invalid_CT_affine")
    voxel_volume = abs(float(np.linalg.det(a[:3, :3])))
    spacing = np.linalg.norm(a[:3, :3], axis=0)
    if min(spacing) < .2 or max(spacing) > 3.0 or voxel_volume < .01:
        raise ValueError("non_HRCT_physical_spacing")
    if not np.issubdtype(ct.dtype, np.number) or np.iscomplexobj(ct):
        raise ValueError("non_numeric_source_HU")
    if not np.isfinite(ct[seg != 0]).all():
        raise ValueError("nonfinite_source_HU")
    if not np.any(seg == 1) or not np.any(seg == 2):
        raise ValueError("both_original_lung_labels_required")
    result = []
    for ident, name in ((1, "right"), (2, "left")):
        region = seg == ident
        n = int(region.sum())
        volume_ml = n * voxel_volume / 1000
        if volume_ml < min_lung_ml / 2:
            raise ValueError("partial_lung_mask_not_valid_for_whole_lung_metric")
        hu = ct[region]
        if float(np.min(hu)) < -1100 or float(np.max(hu)) > 1500:
            raise ValueError("invalid_or_uncalibrated_lung_HU")
        low = region & (ct <= -950)
        positions = np.where(low)
        bbox = ([[int(v.min()), int(v.max())] for v in positions]
                if len(positions[0]) else None)
        low_n = int(low.sum())
        result.append({
            "lung": name,
            "r231Label": ident,
            "maskVoxels": n,
            "modelMaskVolumeMl": round(volume_ml, 3),
            "lowAttenuationVoxelsLeMinus950": low_n,
            "lowAttenuationVolumeMl": round(low_n * voxel_volume / 1000, 3),
            "lowAttenuationFractionPct": round(100 * low_n / n, 4),
            "HUPercentile15": round(float(np.percentile(hu, 15)), 2),
            "lowAttenuationSourceVoxelBox": bbox,
        })
    return result


def report(values, ct_sha, mask_sha, source_license, source_url):
    if source_license not in ("CC0", "CC BY 3.0", "CC BY 4.0") or not source_url.startswith("https://"):
        raise ValueError("public_research_source_license_required")
    if any(len(h) != 64 or any(c not in "0123456789abcdef" for c in h)
           for h in (ct_sha, mask_sha)):
        raise ValueError("source_SHA256_required")
    n = sum(v["maskVoxels"] for v in values)
    low_n = sum(v["lowAttenuationVoxelsLeMinus950"] for v in values)
    return {
        "schema": SCHEMA,
        "task": "whole_lung_densitometric_LAA_minus950_not_diagnosis",
        "modelName": "Lungmask pretrained R231 (external input mask)",
        "publishedModelSource": "https://github.com/JoHof/lungmask",
        "originalCTSHA256": ct_sha,
        "lungmaskSHA256": mask_sha,
        "sourcePublicURL": source_url,
        "sourceLicense": source_license,
        "originalCTHUAndFullInspirationOperatorAttested": True,
        "originalPhysicalGridMatched": True,
        "lungSections": values,
        "totalLungMaskVolumeMl": round(sum(v["modelMaskVolumeMl"] for v in values), 3),
        "overallLowAttenuationFractionPct": round(100 * low_n / n, 4),
        "modelExecutedByThisPostprocessor": False,
        "R231CheckpointVerifiedByThisPostprocessor": False,
        "emphysemaDiagnosis": None,
        "COPDDiagnosis": None,
        "clinicallyValidated": False,
        "noPathologyExcluded": False,
        "patientUseAllowed": False,
        "researchOnly": True,
        "limitations": [
            "Only reviewer-confirmed native HU thin-section inspiratory noncontrast adult full chest CT.",
            "LAA-950 depends on dose, reconstruction kernel and inspiration; NOT a patient diagnosis.",
            "Mask externally supplied; checkpoint identity and model execution not proved by this postprocessor.",
            "No independent expert emphysema scoring, holdout accuracy, patient or cloud mode.",
        ],
    }


def run(ct_path, mask_path, out_path, license_name, source_url):
    import nibabel as nib
    import numpy as np
    if out_path.is_symlink() or out_path.exists() or out_path.suffix != ".json" or not out_path.parent.is_dir():
        raise ValueError("fresh_JSON_output_required")
    for path in (ct_path, mask_path):
        if path.is_symlink() or not path.is_file() or not 256 <= path.stat().st_size <= MAX_BYTES:
            raise ValueError("unbounded_or_symlinked_public_Nifti")
    ct = nib.load(str(ct_path))
    mask = nib.load(str(mask_path))
    if (ct.shape != mask.shape or ct.ndim != 3 or
        ct.header.get_xyzt_units()[0] != "mm" or mask.header.get_xyzt_units()[0] != "mm" or
        not np.allclose(ct.affine, mask.affine, rtol=0, atol=1e-3)):
        raise ValueError("native_CT_and_R231_segmentation_grid_mismatch")
    measured = regions(np.asanyarray(ct.dataobj), np.asanyarray(mask.dataobj), ct.affine)
    evidence = report(measured, sha256(ct_path), sha256(mask_path), license_name, source_url)
    out_path.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ct", type=Path, required=True)
    parser.add_argument("--r231-mask", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-license", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--public-research-consent", action="store_true")
    parser.add_argument("--native-HU-inspiratory-noncontrast-protocol-confirmed", action="store_true")
    args = parser.parse_args()
    if not args.public_research_consent or not args.native_HU_inspiratory_noncontrast_protocol_confirmed:
        parser.error("Approved public CT and reviewed native HU inspiratory noncontrast protocol required")
    evidence = run(args.ct, args.r231_mask, args.output, args.source_license, args.source_url)
    print(json.dumps({"schema": SCHEMA, "lowAttenuationPct": evidence["overallLowAttenuationFractionPct"]}))


if __name__ == "__main__":
    main()
