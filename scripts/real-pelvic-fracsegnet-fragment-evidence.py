#!/usr/bin/env python3
"""PENGWIN 3D pelvic fragment evidence from expert masks or external FracSegNet output.

No trained inference here. Research-only. Never treat a missing fragment as no fracture.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

SCHEMA = "opus-pelvic-fragments-ct/v1"
MAX_VOXELS = 512 * 512 * 520
MAX_FILE = 900 * 1024**2
ANATOMY = {"sacrum": (1, 10), "left_hipbone": (11, 20), "right_hipbone": (21, 30)}
SOURCE = "https://github.com/YzzLiu/FracSegNet"
DATA = "https://zenodo.org/records/10927452"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def source_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file() or not 256 <= path.stat().st_size <= MAX_FILE:
        raise ValueError("missing_symlinked_or_oversized_source")


def load_volume(path: Path):
    """Return X,Y,Z data and matching true NIfTI RAS mm affine (or MHA LPS->RAS)."""
    import numpy as np
    source_file(path)
    if path.name.endswith(".nii.gz") or path.suffix.lower() == ".nii":
        import nibabel as nib
        im = nib.load(str(path))
        if im.ndim != 3 or im.header.get_xyzt_units()[0] != "mm":
            raise ValueError("invalid_NIfTI_physical_mm")
        arr = np.asanyarray(im.dataobj)
        affine = np.array(im.affine, dtype=float)
    elif path.suffix.lower() == ".mha":
        import SimpleITK as sitk
        im = sitk.ReadImage(str(path))
        if im.GetDimension() != 3:
            raise ValueError("invalid_MHA_dimension")
        arr = sitk.GetArrayFromImage(im).transpose(2, 1, 0)
        direction = np.array(im.GetDirection(), dtype=float).reshape(3, 3)
        lps2ras = np.diag([-1., -1., 1.])
        affine = np.eye(4)
        affine[:3, :3] = lps2ras @ direction @ np.diag(im.GetSpacing())
        affine[:3, 3] = lps2ras @ np.array(im.GetOrigin(), dtype=float)
    else:
        raise ValueError("only_NIfTI_or_MHA_supported")
    if (arr.ndim != 3 or min(arr.shape) < 8 or math.prod(arr.shape) > MAX_VOXELS or
        not np.isfinite(affine).all() or affine.shape != (4, 4) or
        not np.allclose(affine[3], [0, 0, 0, 1])):
        raise ValueError("unbounded_or_invalid_original_3D_geometry")
    sizes = np.linalg.norm(affine[:3, :3], axis=0)
    if (min(sizes) < .15 or max(sizes) > 5 or
        abs(np.linalg.det(affine[:3, :3])) < .01):
        raise ValueError("invalid_CT_physical_voxel_size")
    return arr, affine


def check_label_volume(seg, affine, reference_shape, reference_affine):
    import numpy as np
    if seg.shape != reference_shape or not np.allclose(affine, reference_affine, atol=1e-3, rtol=0):
        raise ValueError("pelvic_fragment_mask_not_source_CT_physical_grid")
    if seg.dtype.kind not in "biu" or not np.isin(seg, np.arange(31)).all():
        raise ValueError("invalid_PENGWIN_fragment_label_encoding")


def fragment_components(labels, affine, minimum_fragment_mm3=50.0):
    import numpy as np
    from scipy.ndimage import center_of_mass, find_objects
    data = np.asarray(labels)
    voxels_mm3 = abs(float(np.linalg.det(affine[:3, :3])))
    # PENGWIN labels 1-10 sacrum, 11-20 left, 21-30 right.
    slices = find_objects(data, max_label=30)
    parts = []
    coverage = {}
    for region, (low, high) in ANATOMY.items():
        pieces = []
        for k in range(low, high + 1):
            block = slices[k - 1]
            if block is None:
                continue
            crop = data[block] == k
            count = int(crop.sum())
            bbox = [[int(x.start), int(x.stop - 1)] for x in block]
            ijk = np.asarray(center_of_mass(crop), dtype=float) + np.array([x.start for x in block])
            ras = (affine @ np.r_[ijk, 1])[:3]
            rec = {
                "region": region, "fragmentLabel": k,
                "sourceVoxelBox": bbox,
                "sourceCentroidIJK": [round(float(v), 3) for v in ijk],
                "centroidWorldRASmm": [round(float(v), 3) for v in ras],
                "voxelCount": count, "fragmentVolumeMm3": round(count * voxels_mm3, 3),
                "fragmentVolumeMl": round(count * voxels_mm3 / 1000, 4)
            }
            pieces.append(rec)
            parts.append(rec)
        significant = sum(p["fragmentVolumeMm3"] >= minimum_fragment_mm3 for p in pieces)
        coverage[region] = {
            "presentLabels": [p["fragmentLabel"] for p in pieces],
            "significantFragmentCount": significant,
            "multiFragmentReviewCandidate": significant >= 2,
            "segmentationPresent": bool(pieces),
            "negativeFractureScreen": False
        }
    if not parts:
        raise ValueError("empty_fragment_labels_do_not_exclude_fracture")
    return parts, coverage


def expert_comparison(pred, expert, affine):
    """Per-bone foreground Dice and best-match instance Dice; not fracture sensitivity."""
    import numpy as np
    from scipy.optimize import linear_sum_assignment
    voxel_mm3 = abs(float(np.linalg.det(affine[:3, :3])))
    scores = {}
    for region, (first, last) in ANATOMY.items():
        p = (pred >= first) & (pred <= last)
        e = (expert >= first) & (expert <= last)
        denom = int(p.sum() + e.sum())
        pred_ids = [x for x in range(first, last + 1) if np.any(pred == x)]
        exp_ids = [x for x in range(first, last + 1) if np.any(expert == x)]
        dice = (2 * int(np.count_nonzero(p & e)) / denom) if denom else None
        paired = []
        if pred_ids and exp_ids:
            overlaps = np.zeros((len(pred_ids), len(exp_ids)), dtype=float)
            # Pair instances independent of arbitrary label numbering.
            for i, p_id in enumerate(pred_ids):
                pm = pred == p_id
                for j, e_id in enumerate(exp_ids):
                    em = expert == e_id
                    overlap = int(np.count_nonzero(pm & em))
                    denom2 = int(pm.sum() + em.sum())
                    overlaps[i, j] = 2 * overlap / denom2 if denom2 else 0.0
            rows, cols = linear_sum_assignment(-overlaps)
            paired = [{"prediction": pred_ids[i], "expert": exp_ids[j],
                       "instanceDice": round(float(overlaps[i, j]), 5)}
                      for i, j in zip(rows, cols) if overlaps[i, j] > 0]
        scores[region] = {
            "foregroundBoneUnionDice": round(dice, 5) if dice is not None else None,
            "pairedFragmentInstanceDice": paired,
            "predictionFragmentLabels": len(pred_ids),
            "expertFragmentLabels": len(exp_ids),
            "voxelVolumeMm3": round(voxel_mm3, 5)
        }
    return scores


def build_evidence(parts, coverage, *, source_sha, mask_sha, ref_sha,
                   source_license, origin, comparison):
    if source_license not in ("CC BY 4.0", "CC BY-NC-SA 4.0") or origin != DATA:
        raise ValueError("only_approved_PENGWIN_public_research_source")
    for value in (source_sha, mask_sha, *( [ref_sha] if ref_sha else [])):
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("real_input_SHA256_required")
    return {
        "schema": SCHEMA, "modality": "CT", "task": "pelvic_bone_fragment_spatial_review",
        "modelCandidate": "FracSegNet publisher pretrained fracture-specific nnU-Net",
        "publisherSourceURL": SOURCE, "dataSourceURL": origin, "researchDataLicenseAsDeclared": source_license,
        "sourceCTSHA256": source_sha, "sourceMaskSHA256": mask_sha,
        "expertMaskSHA256": ref_sha,
        "fragmentComponents": parts, "regionCoverage": coverage,
        "expertComparisonIfProvided": comparison,
        "inputPhysicalGeometryMatched": True,
        "realPretrainedModelExecutedInThisAdapter": False,
        "sourceMaskProvenToBePublisherWeightsOutput": False,
        "expertLabelsIndependentOfTrainingProven": False,
        "fractureDiagnosticAccuracyEstablished": False,
        "researchOnly": True, "patientUseAllowed": False, "absenceOfFractureEstablished": False,
        "warnings": [
            "PENGWIN labels encode separately annotated bone fragments, not voxel fracture lines.",
            "One or multiple significant segments alone does not prove or exclude fracture.",
            "A supplied prediction mask is not cryptographic evidence of vendor model execution.",
            "Bone union Dice or instance Dice against a training-split reference are NOT clinical fracture sensitivity.",
            "Research-only data with conflicting metadata/author use terms: do not redistribute or use commercially without clearance.",
            "No inference, patient upload, remote LLM or raw image output performed by this adapter."
        ]
    }


def run(ct_path: Path, mask_path: Path, output: Path, license_name: str,
        reference_path: Path | None = None):
    import numpy as np
    if output.exists() or output.is_symlink() or output.suffix.lower() != ".json" or not output.parent.is_dir():
        raise ValueError("new_numeric_JSON_output_required")
    ct, a = load_volume(ct_path)
    predicted, b = load_volume(mask_path)
    check_label_volume(predicted, b, ct.shape, a)
    pieces, coverage = fragment_components(predicted, a)
    compare = None
    refsha = None
    if reference_path:
        truth, c = load_volume(reference_path)
        check_label_volume(truth, c, ct.shape, a)
        compare = expert_comparison(predicted, truth, a)
        refsha = sha256(reference_path)
    result = build_evidence(
        pieces, coverage, source_sha=sha256(ct_path), mask_sha=sha256(mask_path),
        ref_sha=refsha, source_license=license_name, origin=DATA, comparison=compare
    )
    output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--public-ct", type=Path, required=True)
    p.add_argument("--fragment-mask", type=Path, required=True)
    p.add_argument("--expert-mask", type=Path)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--source-license", required=True, choices=["CC BY 4.0", "CC BY-NC-SA 4.0"])
    p.add_argument("--public-deidentified-research-rights-confirmed", action="store_true")
    args = p.parse_args()
    if not args.public_deidentified_research_rights_confirmed:
        p.error("Only independently cleared public deidentified PENGWIN images accepted")
    result = run(args.public_ct, args.fragment_mask, args.output, args.source_license, args.expert_mask)
    print(json.dumps({"schema": result["schema"], "fragmentCount": len(result["fragmentComponents"]),
                      "actualTrainedModelInference": False, "clinicalDiagnosis": False}))


if __name__ == "__main__":
    main()
