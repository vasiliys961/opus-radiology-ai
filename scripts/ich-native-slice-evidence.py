#!/usr/bin/env python3
"""Analyze slice-level errors on a genuine SAMIHS prediction and expert mask.

The existing offline evaluator first verifies rights attestation, SHA-256 hashes,
source geometry and binary labels. Not a model run or clinical validation.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import sys


def load_evaluator():
    target = Path(__file__).with_name("evaluate-ich-public-mask.py")
    spec = importlib.util.spec_from_file_location("ich_evaluator", target)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def analyze_slices(prediction, expert, axis, metrics):
    import numpy as np
    if type(axis) is not int or axis not in (0, 1, 2):
        raise ValueError("source_slice_axis_required")
    if (prediction.shape != expert.shape or prediction.ndim != 3
            or prediction.dtype != np.dtype(bool)
            or expert.dtype != np.dtype(bool)):
        raise ValueError("index_aligned_boolean_masks_required")
    p_slices = np.moveaxis(prediction, axis, 0)
    e_slices = np.moveaxis(expert, axis, 0)
    rows = []
    for index in range(p_slices.shape[0]):
        p, e = p_slices[index], e_slices[index]
        pc, ec = int(np.count_nonzero(p)), int(np.count_nonzero(e))
        tp = int(np.count_nonzero(p & e))
        rows.append({
            "nativeSliceIndex": index,
            "predictedVoxels": pc, "expertVoxels": ec, "overlapVoxels": tp,
            "falseNegativeVoxels": ec - tp, "falsePositiveVoxels": pc - tp,
            "sliceDice": 2 * tp / (pc + ec) if pc + ec else None
        })
    if (sum(r["overlapVoxels"] for r in rows) != metrics["truePositiveVoxels"]
            or sum(r["falseNegativeVoxels"] for r in rows) != metrics["falseNegativeVoxels"]
            or sum(r["falsePositiveVoxels"] for r in rows) != metrics["falsePositiveVoxels"]):
        raise ValueError("native_slice_counts_do_not_match_3d_metrics")
    missed = [r["nativeSliceIndex"] for r in rows if r["expertVoxels"] and not r["overlapVoxels"]]
    model_only = [r["nativeSliceIndex"] for r in rows
                  if r["predictedVoxels"] and not r["expertVoxels"]]
    return {
        "sourceBoundSliceAxis": axis, "totalSourceSlices": len(rows),
        "expertPositiveSlices": sum(bool(r["expertVoxels"]) for r in rows),
        "modelCandidateSlices": sum(bool(r["predictedVoxels"]) for r in rows),
        "expertPositiveSlicesWithVoxelOverlap": sum(
            bool(r["expertVoxels"] and r["overlapVoxels"]) for r in rows),
        "expertPositiveSlicesWithoutOverlap": missed,
        "modelOnlyCandidateSlices": model_only,
        "sliceEvidence": rows, "clinicalSliceSensitivity": None,
        "originalDicomSopMapped": False
    }


def run(args):
    evaluator = load_evaluator()
    output = Path(args.slice_output)
    if (output.exists() or output.is_symlink() or not output.parent.is_dir()
            or output.parent.is_symlink() or output.resolve() == Path(args.output).resolve()):
        raise ValueError("new_separate_slice_report_required")
    if args.public_research_authorization != "PUBLIC-ICH-REFERENCE-REVIEW" or not args.rights_attested:
        raise ValueError("explicit_public_reference_rights_required")
    inference_report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    axis = inference_report.get("source", {}).get("geometry", {}).get("sliceAxis")
    if type(axis) is not int or axis not in (0, 1, 2):
        raise ValueError("source_slice_axis_required")
    comparison = evaluator.run(args)
    p_nii, _, _ = evaluator.load_geometry(evaluator.check_file(Path(args.prediction)))
    e_nii, _, _ = evaluator.load_geometry(
        evaluator.check_file(Path(args.reference)), p_nii.shape)
    p = evaluator.binary_mask(p_nii)
    e = evaluator.binary_mask(e_nii, label=args.reference_label)
    slices = analyze_slices(p, e, axis, comparison["metrics"])
    result = {
        "schema": "opus-ich-native-slice-evidence/v1",
        "status": "verified_public_mask_pair_slice_review_not_diagnostic_validation",
        "comparisonSchema": comparison["schema"],
        "evidenceHashes": comparison["evidenceHashes"],
        "modelId": comparison["modelId"], "referenceLabel": comparison["referenceLabel"],
        "caseCount": 1, "sliceAudit": slices, "clinicalValidation": False,
        "limitations": [
            "Native NIfTI indices are not original DICOM slice numbers.",
            "Mask overlap is not lesion-level or diagnostic sensitivity.",
            "Training-set overlap and reference provenance require external review.",
            "No model candidates never establishes a negative clinical diagnosis."
        ]
    }
    output.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for field in ("source", "prediction", "reference", "report", "reference-sha256",
                  "output", "slice-output", "public-research-authorization"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--reference-label", type=int, default=1)
    parser.add_argument("--rights-attested", action="store_true")
    args = parser.parse_args()
    try:
        result = run(args)
        print(json.dumps({
            "status": result["status"],
            "expertPositiveSlices": result["sliceAudit"]["expertPositiveSlices"],
            "missedExpertSlices": len(result["sliceAudit"]["expertPositiveSlicesWithoutOverlap"]),
            "modelOnlyCandidateSlices": len(result["sliceAudit"]["modelOnlyCandidateSlices"]),
            "clinicalValidation": False
        }))
    except Exception as err:
        print("ICH slice evidence failed: " + type(err).__name__ + ": " +
              str(err).split("/")[0][:120], file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
