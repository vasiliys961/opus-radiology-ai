#!/usr/bin/env python3
"""Compare a genuine pretrained ICH binary prediction with an authorized expert mask.

Standalone, offline and explicitly research-only. No training, resampling,
automatic diagnosis, patient upload or fabricated reference annotations.

Example: python scripts/evaluate-ich-public-mask.py --source PUBLIC.nii.gz
  --prediction mask.nii.gz --reference expert.nii.gz --report model-report.json
  --reference-sha256 <sha256> --output comparisons.json
  --public-research-authorization PUBLIC-ICH-REFERENCE-REVIEW
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import sys

MAX_BYTES = 512 * 1024 * 1024
MAX_VOXELS = 512 * 512 * 400
HD95_MAX_CROP_VOXELS = 8_000_000
HD95_MAX_UNION_VOXELS = 3_000_000
HD95_MAX_SURFACE_POINTS = 250_000
HD95_QUERY_BATCH = 8192
SCHEMA = "opus-ich-public-expert-mask-comparison/v1"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as reader:
        for block in iter(lambda: reader.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def check_file(path: Path) -> Path:
    if path.is_symlink() or not path.is_file() or path.suffix not in (".nii", ".gz"):
        raise ValueError("expected_regular_nifti_file")
    if not 0 < path.stat().st_size <= MAX_BYTES:
        raise ValueError("nifti_file_size_out_of_bounds")
    if not path.name.endswith((".nii", ".nii.gz")):
        raise ValueError("unsupported_nifti_extension")
    return path.resolve()


def check_sha(value: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        raise ValueError("invalid_sha256")
    return value


def load_geometry(path: Path, expected_shape=None):
    import nibabel as nib
    import numpy as np

    nii = nib.load(str(path))
    if nii.ndim != 3 or not 0 < math.prod(nii.shape) <= MAX_VOXELS:
        raise ValueError("not_supported_3d_nifti")
    if expected_shape is not None and tuple(nii.shape) != tuple(expected_shape):
        raise ValueError("nifti_shape_mismatch")
    if nii.header.get_xyzt_units()[0] != "mm" or int(nii.header["sform_code"]) <= 0:
        raise ValueError("nifti_mm_sform_required")
    affine = np.asarray(nii.affine, dtype=np.float64)
    if not np.all(np.isfinite(affine)) or not np.allclose(affine[3], [0, 0, 0, 1], atol=1e-6):
        raise ValueError("nifti_affine_invalid")
    qcode = int(nii.header["qform_code"])
    if qcode > 0 and not np.allclose(nii.get_qform(), affine, atol=0.05, rtol=0):
        raise ValueError("conflicting_nifti_sform_qform")
    determinant = float(np.linalg.det(affine[:3, :3]))
    if not 0.000001 <= abs(determinant) <= 1000:
        raise ValueError("invalid_mm_voxel_volume")
    return nii, affine, abs(determinant) / 1000


def assert_same_grid(affine_a, affine_b, dimensions):
    import numpy as np

    for x in (0, dimensions[0] - 1):
        for y in (0, dimensions[1] - 1):
            for z in (0, dimensions[2] - 1):
                index = np.array([x, y, z, 1.], dtype=float)
                separation = np.linalg.norm((affine_a @ index)[:3] - (affine_b @ index)[:3])
                if not math.isfinite(separation) or separation > 0.05:
                    raise ValueError("mask_and_reference_grids_do_not_match")
    return True


def binary_mask(nii, label: int | None = None):
    import numpy as np

    datatype = nii.header.get_data_dtype()
    if datatype.kind not in ("i", "u"):
        raise ValueError("reference_and_model_masks_must_be_integer")
    # Nibabel moves valid NIfTI scaling into the ArrayProxy at load time.
    # Header values alone may be NaN even when the file contains scaling.
    if not math.isclose(float(nii.dataobj.slope), 1., abs_tol=1e-9) or not math.isclose(
        float(nii.dataobj.inter), 0., abs_tol=1e-9
    ):
        raise ValueError("scaled_mask_not_allowed")
    array = np.asanyarray(nii.dataobj)
    if label is None:
        if np.any((array != 0) & (array != 1)):
            raise ValueError("predicted_mask_not_binary")
        return np.asarray(array == 1, dtype=np.bool_)
    if not isinstance(label, int) or label < 1 or label > 65535:
        raise ValueError("reference_label_must_be_positive")
    if np.any(array < 0) or (np.any(array != 0) and not np.any(array == label)):
        raise ValueError("reference_label_not_present")
    return np.asarray(array == label, dtype=np.bool_)


def estimate_hd95_mm(predicted, expert, affine):
    """Surface HD95 only for matching orthogonal source grids and safe ROI size.

    Percentile of pooled bidirectional surface-to-surface distances; not HDmax.
    """
    import numpy as np
    from scipy import ndimage

    if not predicted.any() or not expert.any():
        return None, "nonempty_prediction_and_reference_required"
    axes = np.asarray(affine[:3, :3], dtype=float)
    lengths = np.linalg.norm(axes, axis=0)
    cosines = axes / lengths[None, :]
    if np.max(np.abs(cosines.T @ cosines - np.eye(3))) > 1e-4:
        return None, "sheared_affine_hd95_not_supported"
    # Bound nonzero-coordinate allocation before using np.where on large volumes.
    if (int(np.count_nonzero(predicted)) + int(np.count_nonzero(expert))
            > HD95_MAX_UNION_VOXELS):
        return None, "hd95_positive_voxel_memory_limit_exceeded"
    where = np.array(np.where(predicted | expert))
    low = np.maximum(where.min(axis=1) - 2, 0)
    high = np.minimum(where.max(axis=1) + 3, predicted.shape)
    crop_shape = high - low
    slices = tuple(slice(int(a), int(b)) for a, b in zip(low, high))
    p = predicted[slices]
    e = expert[slices]
    structure = ndimage.generate_binary_structure(3, 1)
    p_surface = p & ~ndimage.binary_erosion(p, structure=structure, border_value=0)
    e_surface = e & ~ndimage.binary_erosion(e, structure=structure, border_value=0)
    if int(np.prod(crop_shape)) <= HD95_MAX_CROP_VOXELS:
        # Exact EDT path for compact localized hemorrhage masks.
        d_to_e = ndimage.distance_transform_edt(~e_surface, sampling=lengths)
        e_distances = d_to_e[p_surface]
        del d_to_e
        d_to_p = ndimage.distance_transform_edt(~p_surface, sampling=lengths)
        p_distances = d_to_p[e_surface]
    else:
        # Sparse, EXACT surface nearest-neighbour path. A remote false-positive
        # voxel can make the bounding cuboid enormous although the actual
        # hemorrhage surfaces are tiny. Never allocate two full-volume EDTs.
        from scipy.spatial import cKDTree
        np_count = int(np.count_nonzero(p_surface))
        ne_count = int(np.count_nonzero(e_surface))
        if max(np_count, ne_count) > HD95_MAX_SURFACE_POINTS:
            return None, "hd95_surface_point_memory_limit_exceeded"
        p_points = np.column_stack(np.nonzero(p_surface)).astype(np.float64)
        e_points = np.column_stack(np.nonzero(e_surface)).astype(np.float64)
        if not len(p_points) or not len(e_points):
            return None, "empty_surface"
        p_points *= lengths
        e_points *= lengths
        def distances(points, reference):
            tree = cKDTree(reference)
            result = np.empty(len(points), dtype=np.float64)
            for start in range(0, len(points), HD95_QUERY_BATCH):
                stop = min(start + HD95_QUERY_BATCH, len(points))
                result[start:stop] = tree.query(points[start:stop], k=1, workers=1)[0]
            return result
        e_distances = distances(p_points, e_points)
        p_distances = distances(e_points, p_points)
    if e_distances.size == 0 or p_distances.size == 0:
        return None, "empty_surface"
    return float(np.percentile(np.concatenate((e_distances, p_distances)), 95)), None


def segmentation_metrics(prediction, reference, voxel_ml, affine):
    import numpy as np

    if prediction.shape != reference.shape or prediction.dtype != np.bool_ or reference.dtype != np.bool_:
        raise ValueError("binary_index_aligned_masks_required")
    tp = int(np.count_nonzero(prediction & reference))
    fp = int(np.count_nonzero(prediction & ~reference))
    fn = int(np.count_nonzero(~prediction & reference))
    pred_count = tp + fp
    ref_count = tp + fn
    dice = 2 * tp / (2 * tp + fp + fn) if pred_count + ref_count else None
    iou = tp / (tp + fp + fn) if tp + fp + fn else None
    precision = tp / pred_count if pred_count else None
    recall = tp / ref_count if ref_count else None
    hd95, hd95_reason = estimate_hd95_mm(prediction, reference, affine)
    pred_ml = pred_count * voxel_ml
    ref_ml = ref_count * voxel_ml
    return {
        "truePositiveVoxels": tp,
        "falsePositiveVoxels": fp,
        "falseNegativeVoxels": fn,
        "dice": dice,
        "iou": iou,
        "voxelPrecision": precision,
        "voxelRecall": recall,
        "hd95Mm": hd95,
        "hd95UnavailableReason": hd95_reason,
        "predictedVolumeMl": pred_ml,
        "expertMaskVolumeMl": ref_ml,
        "volumeErrorMl": pred_ml - ref_ml,
        "absoluteVolumeErrorMl": abs(pred_ml - ref_ml),
        "relativeVolumeError": (pred_ml - ref_ml) / ref_ml if ref_count else None,
        "bothMasksEmpty": pred_count == 0 and ref_count == 0,
        "clinicalSensitivity": None,
        "frocFalsePositivesPerScan": None,
    }


def run(args):
    if args.public_research_authorization != "PUBLIC-ICH-REFERENCE-REVIEW":
        raise ValueError("public_reference_permission_must_be_explicit")
    if not args.rights_attested:
        raise ValueError("reference_data_rights_not_attested")
    source = check_file(Path(args.source))
    prediction = check_file(Path(args.prediction))
    reference = check_file(Path(args.reference))
    if len({str(source), str(prediction), str(reference)}) != 3:
        raise ValueError("source_prediction_reference_must_be_distinct")
    report_path = Path(args.report)
    if report_path.is_symlink() or not report_path.is_file() or report_path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("invalid_model_inference_report")
    report = json.loads(report_path.read_text(encoding="utf-8"))
    if report.get("schema") != "opus-ich-samihs-public-research/v1":
        raise ValueError("unrecognized_trained_inference_report")
    src = report.get("source", {})
    pred = report.get("prediction", {})
    model = report.get("model", {})
    if src.get("patientData") is not False or src.get("sourceDicomSopBound") is not False or \
            report.get("validation", {}).get("clinicalValidation") is not False or \
            model.get("modelWeightsUsed") is not True:
        raise ValueError("unexpected_clinical_or_source_claim")
    hashes = {
        "sourceSha256": sha256(source),
        "predictionSha256": sha256(prediction),
        "expertMaskSha256": sha256(reference),
    }
    if hashes["sourceSha256"] != check_sha(src.get("sha256")) or \
            hashes["predictionSha256"] != check_sha(pred.get("maskSha256")) or \
            hashes["expertMaskSha256"] != check_sha(args.reference_sha256):
        raise ValueError("source_prediction_or_reference_sha256_mismatch")
    ct_nii, ct_affine, voxel_ml = load_geometry(source)
    pred_nii, pred_affine, pred_voxel_ml = load_geometry(prediction, ct_nii.shape)
    ref_nii, ref_affine, ref_voxel_ml = load_geometry(reference, ct_nii.shape)
    assert_same_grid(ct_affine, pred_affine, ct_nii.shape)
    assert_same_grid(ct_affine, ref_affine, ct_nii.shape)
    if max(abs(voxel_ml - pred_voxel_ml), abs(voxel_ml - ref_voxel_ml)) > 1e-6:
        raise ValueError("voxel_volume_mismatch")
    declared = src.get("geometry", {})
    if declared.get("dimensions") != list(ct_nii.shape) or \
            not math.isclose(declared.get("voxelVolumeMl", -1), voxel_ml, abs_tol=1e-6) or \
            not isinstance(declared.get("affineRas"), list):
        raise ValueError("source_geometry_not_bound_to_inference")
    import numpy as np
    if not np.allclose(np.asarray(declared["affineRas"]), ct_affine, atol=0.05, rtol=0):
        raise ValueError("source_affine_not_bound_to_inference")
    p = binary_mask(pred_nii)
    reference_label = args.reference_label
    e = binary_mask(ref_nii, label=reference_label)
    if int(np.count_nonzero(p)) != pred.get("predictedPositiveVoxelCount"):
        raise ValueError("reported_positive_voxel_count_not_verified")
    if not math.isclose(float(pred.get("predictedMaskVolumeMl", -1)),
                        int(np.count_nonzero(p)) * voxel_ml, abs_tol=0.000051):
        raise ValueError("reported_mask_volume_not_verified")
    measured = segmentation_metrics(p, e, voxel_ml, ct_affine)
    output = {
        "schema": SCHEMA,
        "status": "single_public_case_mask_comparison_not_independent_validation",
        "modelId": "samihs-ich-binary-ct",
        "evidenceHashes": hashes,
        "referenceLabel": reference_label,
        "referenceRightsAttested": True,
        "sourceNativeIndexGridMatch": True,
        "sourceDicomSopBound": False,
        "heldOutFromTrainingProven": False,
        "expertAnnotationAuthenticityIndependentlyVerified": False,
        "caseCount": 1,
        "metrics": measured,
        "clinicalValidation": False,
        "limitations": [
            "Metrics compare binary masks for a single authorized case only.",
            "Reference annotation source and rights require independent audit.",
            "Unknown training overlap; not an independently held-out external test.",
            "Voxel recall is not lesion-level or patient-level diagnostic sensitivity.",
            "No model detection of hemorrhage subtype.",
            "NIfTI native-grid agreement does not establish original DICOM SOP correspondence.",
            "Missing mask does not establish absence of intracranial hemorrhage.",
        ],
    }
    destination = Path(args.output)
    if destination.exists() or destination.is_symlink() or not destination.parent.is_dir():
        raise ValueError("output_must_be_new_in_existing_directory")
    destination.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("source", "prediction", "reference", "report", "reference-sha256", "output",
                "public-research-authorization"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--reference-label", type=int, default=1,
                        help="Positive expert mask label, default 1; other labels excluded")
    parser.add_argument("--rights-attested", action="store_true",
                        help="Research operator confirmed rights to use this reference mask")
    args = parser.parse_args()
    try:
        output = run(args)
        print(json.dumps({
            "status": output["status"],
            "dice": output["metrics"]["dice"],
            "hd95Mm": output["metrics"]["hd95Mm"],
            "clinicalValidation": False,
        }))
    except Exception as error:
        print("ICH mask comparison failed: " + type(error).__name__ + ": " +
              str(error).split("/")[0][:120], file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
