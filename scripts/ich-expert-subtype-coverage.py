#!/usr/bin/env python3
"""Actual per-ontology expert ICH subtype voxel coverage of one SAMIHS binary mask.

Only the ORIGINAL licensed multiclass expert labels provide IPH/IVH/SAH/SDH/EDH.
SAMIHS remains binary: these are conditional expert-subtype voxel recalls,
NOT model subtype classification or lesion/patient-level clinical sensitivity.
No GPU, network, patient uploads or invented reference masks.
"""
from __future__ import annotations

import importlib.util
import math
from pathlib import Path

MAX_VOXELS = 512 * 512 * 400


def measure_coverage(predicted, derived_union, original_labels, meanings,
                     expected_counts, metrics, voxel_ml):
    import numpy as np

    if (predicted.shape != derived_union.shape or
            predicted.shape != original_labels.shape or
            predicted.ndim != 3 or math.prod(predicted.shape) > MAX_VOXELS or
            predicted.dtype != np.dtype(bool) or
            derived_union.dtype != np.dtype(bool) or
            original_labels.dtype.kind not in "iu" or
            not math.isfinite(voxel_ml) or voxel_ml <= 0 or
            not 1 <= len(meanings) <= 32 or
            set(expected_counts) != {str(x) for x in meanings}):
        raise ValueError("unverified_multiclass_ich_coverage_inputs")
    if np.any(original_labels < 0):
        raise ValueError("negative_original_expert_labels")
    if np.count_nonzero(original_labels) != np.count_nonzero(derived_union):
        raise ValueError("original_expert_binary_union_voxel_count_mismatch")
    if not np.array_equal(derived_union, original_labels != 0):
        raise ValueError("original_expert_binary_union_pixels_mismatch")
    rows = []
    total_overlap = 0
    total_missed = 0
    total_expert = 0
    for label in sorted(meanings):
        name = meanings[label]
        if name not in {"IPH", "IVH", "SAH", "SDH", "EDH"}:
            raise ValueError("undocumented_ich_expert_subtype")
        class_voxels = original_labels == label
        n = int(np.count_nonzero(class_voxels))
        if type(expected_counts[str(label)]) is not int or n != expected_counts[str(label)]:
            raise ValueError("original_expert_label_count_mismatch")
        overlap = int(np.count_nonzero(predicted & class_voxels))
        missed = n - overlap
        total_overlap += overlap
        total_missed += missed
        total_expert += n
        rows.append({
            "sourceLabel": label,
            "expertSubtype": name,
            "expertVoxels": n,
            "expertVolumeMl": round(n * voxel_ml, 6),
            "modelOverlappingExpertVoxels": overlap,
            "modelMissedExpertVoxels": missed,
            "voxelCoverageFraction": overlap / n if n else None,
            "modelPredictedSubtype": False,
        })
    if (total_expert != int(np.count_nonzero(derived_union)) or
            total_overlap != metrics["truePositiveVoxels"] or
            total_missed != metrics["falseNegativeVoxels"] or
            int(np.count_nonzero(predicted & ~derived_union)) != metrics["falsePositiveVoxels"]):
        raise ValueError("per_subtype_totals_do_not_match_independent_3d_metrics")
    return {
        "schema": "opus-ich-original-expert-subtype-coverage/v1",
        "sourceOriginalMulticlassExpertRequired": True,
        "modelSubtypeClassifierExecuted": False,
        "expertVoxelClasses": rows,
        "totalExpertVoxels": total_expert,
        "totalOverlappingExpertVoxels": total_overlap,
        "totalMissedExpertVoxels": total_missed,
        "clinicalSubtypeSensitivity": None,
        "clinicianReviewRequired": True,
    }


def score_source_bound_case(source_path, prediction_path, derived_path,
                            original_path, ontology_path, expected_counts, metrics):
    import numpy as np

    eval_path = Path(__file__).with_name("evaluate-ich-public-mask.py")
    spec = importlib.util.spec_from_file_location("ich_eval_subtype", eval_path)
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    ontology_module = Path(__file__).with_name("build-ich-expert-binary-union.py")
    spec = importlib.util.spec_from_file_location("ich_label_ontology", ontology_module)
    ontology_verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(ontology_verifier)
    import json

    ontology = json.loads(Path(ontology_path).read_text(encoding="utf-8"))
    meanings = ontology_verifier.check_ontology(ontology)
    source, source_affine, voxel_ml = evaluator.load_geometry(
        evaluator.check_file(Path(source_path)))
    pred, p_affine, _ = evaluator.load_geometry(
        evaluator.check_file(Path(prediction_path)), source.shape)
    derived, d_affine, _ = evaluator.load_geometry(
        evaluator.check_file(Path(derived_path)), source.shape)
    original, o_affine, _ = evaluator.load_geometry(
        evaluator.check_file(Path(original_path)), source.shape)
    for affine in (p_affine, d_affine, o_affine):
        evaluator.assert_same_grid(source_affine, affine, source.shape)
    p = evaluator.binary_mask(pred)
    d = evaluator.binary_mask(derived, label=1)
    if original.header.get_data_dtype().kind not in "iu":
        raise ValueError("original_expert_labels_must_be_integer")
    if (not math.isclose(float(original.dataobj.slope), 1., abs_tol=1e-9) or
            not math.isclose(float(original.dataobj.inter), 0., abs_tol=1e-9)):
        raise ValueError("scaled_original_expert_labelmap_not_supported")
    o = np.asanyarray(original.dataobj)
    return measure_coverage(p, d, o, meanings, expected_counts, metrics, voxel_ml)
