#!/usr/bin/env python3
"""Source-bound 3D connected-component localization of ICH segmentation errors.

Accepts ONLY an authorized real SAMIHS prediction and expert reference pair.
First invokes the existing independent SHA/geometry/voxel evaluator; then
compares 6-neighbor 3D connected mask fragments. These are not individually
diagnosed hematomas, lesion-detection scores, or independently validated claims.
No CT pixels, component coordinates in patient DICOM, or PHI leave this process.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import math
from pathlib import Path
import sys

MAX_COMPONENT_VOXELS = 512 * 512 * 400  # Same full-volume admission as SAMIHS and expert evaluator.
MAX_COMPONENTS = 4096
MAX_OVERLAP_VOXELS = 1_000_000
MAX_REPORTED_COMPONENTS = 128


def evaluator_module():
    path = Path(__file__).with_name("evaluate-ich-public-mask.py")
    spec = importlib.util.spec_from_file_location("ich_reference_eval", path)
    evaluator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(evaluator)
    return evaluator


def component_overlap_evidence(prediction, reference, voxel_ml, voxel_metrics):
    """Bounded 6-connected component contact without training/label assumptions."""
    import numpy as np
    from scipy import ndimage

    if (prediction.shape != reference.shape or prediction.ndim != 3
            or prediction.dtype != np.dtype(bool) or reference.dtype != np.dtype(bool)
            or math.prod(prediction.shape) > MAX_COMPONENT_VOXELS
            or not np.isfinite(voxel_ml) or voxel_ml <= 0):
        raise ValueError("unsupported_3d_binary_component_geometry")
    if int(np.count_nonzero(prediction & reference)) > MAX_OVERLAP_VOXELS:
        raise ValueError("overlap_exceeds_bounded_component_memory")

    connectivity = ndimage.generate_binary_structure(3, 1)
    p_labels, npred = ndimage.label(prediction, structure=connectivity)
    e_labels, nexpert = ndimage.label(reference, structure=connectivity)
    if npred > MAX_COMPONENTS or nexpert > MAX_COMPONENTS:
        raise ValueError("fragmented_mask_component_limit_exceeded")

    p_counts = np.bincount(p_labels.ravel(), minlength=npred + 1)
    e_counts = np.bincount(e_labels.ravel(), minlength=nexpert + 1)
    p_boxes = ndimage.find_objects(p_labels)
    e_boxes = ndimage.find_objects(e_labels)
    contact_p = [[] for _ in range(npred + 1)]
    contact_e = [[] for _ in range(nexpert + 1)]
    overlapping = (p_labels != 0) & (e_labels != 0)
    if np.any(overlapping):
        # Pair encoding avoids a dense (number-of-components)^2 table.
        base = npred + 1
        pairs = e_labels[overlapping].astype(np.int64) * base + p_labels[overlapping]
        codes, counts = np.unique(pairs, return_counts=True)
        for code, count in zip(codes, counts):
            expert_id, model_id = divmod(int(code), base)
            count = int(count)
            contact_e[expert_id].append((model_id - 1, count))
            contact_p[model_id].append((expert_id - 1, count))
    del overlapping

    def rows(counts, boxes, contacts, labeled_mask, other_mask):
        ordered = sorted(range(1, len(counts)), key=lambda n: (-int(counts[n]), n))
        results = []
        for index in ordered[:MAX_REPORTED_COMPONENTS]:
            box = boxes[index - 1]
            if box is None:
                raise ValueError("inconsistent_connected_component_box")
            n = int(counts[index])
            linked = sorted(contacts[index], key=lambda a: (-a[1], a[0]))
            contact_voxels = sum(v for _, v in linked)
            # Aim a clinician at the ACTUAL native-k slice with the greatest
            # number of unmatched mask voxels, not the midpoint of a bounding
            # box (which may contain no component pixels at all).
            component = labeled_mask[box] == index
            missing = component & ~other_mask[box]
            per_k = np.count_nonzero(missing, axis=(0, 1))
            if not np.any(per_k):
                per_k = np.count_nonzero(component, axis=(0, 1))
                worst_error = 0
            else:
                worst_error = int(np.max(per_k))
            review_k = int(box[2].start + np.argmax(per_k))
            results.append({
                "componentIndex": index - 1,
                "voxelCount": n,
                "volumeMl": round(n * voxel_ml, 6),
                "boundsVoxelMin": [int(s.start) for s in box],
                "boundsVoxelMax": [int(s.stop - 1) for s in box],
                "otherMaskComponentIndices": [i for i, _ in linked],
                "overlapVoxels": contact_voxels,
                "unmatchedVoxels": n - contact_voxels,
                "reviewSliceIndexK": review_k,
                "reviewSliceUnmatchedVoxels": worst_error,
                "componentOverlapFraction": contact_voxels / n,
                "hasAnyVoxelOverlap": contact_voxels > 0,
                "ambiguousMultiComponentContact": len(linked) > 1,
            })
        return results

    tp = sum(sum(n for _, n in contacts) for contacts in contact_e)
    p_all = int(np.sum(p_counts[1:]))
    e_all = int(np.sum(e_counts[1:]))
    if (tp != voxel_metrics["truePositiveVoxels"] or
        p_all - tp != voxel_metrics["falsePositiveVoxels"] or
        e_all - tp != voxel_metrics["falseNegativeVoxels"]):
        raise ValueError("components_disagree_with_verified_voxel_metrics")

    result = {
        "connectivity": "6_neighbor_index_space",
        "allComponentsCounted": True,
        "reportedLargestPerMaskLimit": MAX_REPORTED_COMPONENTS,
        "expertFragmentsTotal": nexpert,
        "predictedFragmentsTotal": npred,
        "expertFragmentsWithAnyVoxelOverlap": sum(bool(x) for x in contact_e[1:]),
        "expertFragmentsWithZeroOverlap": sum(not x for x in contact_e[1:]),
        "predictedFragmentsWithZeroOverlap": sum(not x for x in contact_p[1:]),
        "expertFragmentsContactingMultiplePredictions": sum(len(x) > 1 for x in contact_e[1:]),
        "predictedFragmentsContactingMultipleExpertFragments": sum(len(x) > 1 for x in contact_p[1:]),
        "largestExpertFragments": rows(e_counts, e_boxes, contact_e, e_labels, prediction),
        "largestPredictedFragments": rows(p_counts, p_boxes, contact_p, p_labels, reference),
        "clinicalLesionSensitivity": None,
        "clinicalFalsePositivesPerScan": None,
        "hemorrhageSubtypesDetermined": False,
    }
    del p_labels, e_labels
    return result


def run(args):
    evaluator = evaluator_module()
    destination = Path(args.component_output)
    other = Path(args.output)
    if (destination.is_symlink() or destination.exists() or not destination.parent.is_dir()
            or destination.parent.is_symlink() or destination.resolve() == other.resolve()):
        raise ValueError("new_distinct_component_output_required")
    if args.public_research_authorization != "PUBLIC-ICH-REFERENCE-REVIEW" or not args.rights_attested:
        raise ValueError("explicit_approved_public_reference_required")

    # Establish source file rights assertion, real inference report contract, SHA
    # for source/model/label, native affine, integer reference labels and voxel Dice.
    verified = evaluator.run(args)
    p_nii, _, voxel_ml = evaluator.load_geometry(
        evaluator.check_file(Path(args.prediction)))
    e_nii, _, _ = evaluator.load_geometry(
        evaluator.check_file(Path(args.reference)), p_nii.shape)
    p = evaluator.binary_mask(p_nii)
    e = evaluator.binary_mask(e_nii, label=args.reference_label)
    evidence = component_overlap_evidence(p, e, voxel_ml, verified["metrics"])
    result = {
        "schema": "opus-ich-expert-component-contact/v1",
        "status": "single_authorized_mask_pair_component_overlap_not_lesion_detection_validation",
        "comparisonSchema": verified["schema"],
        "evidenceHashes": verified["evidenceHashes"],
        "modelId": verified["modelId"],
        "referenceLabel": verified["referenceLabel"],
        "sourceNativeIndexGridMatch": True,
        "caseCount": 1,
        "componentEvidence": evidence,
        "clinicalValidation": False,
        "limitations": [
            "A connected mask fragment is NOT an independently identified hematoma.",
            "One voxel of overlap is not proof of lesion-level clinical detection.",
            "6-neighbor connectivity fragments structures in thick/anisotropic CT slices.",
            "No subtype inference, no original DICOM SOP binding, no held-out proof.",
            "Expert mask provenance/rights and clinical interpretation require review."
        ]
    }
    destination.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ("source", "prediction", "reference", "report", "reference-sha256",
                "output", "component-output", "public-research-authorization"):
        parser.add_argument("--" + key, required=True)
    parser.add_argument("--reference-label", type=int, default=1)
    parser.add_argument("--rights-attested", action="store_true")
    args = parser.parse_args()
    try:
        result = run(args)
        e = result["componentEvidence"]
        print(json.dumps({
            "status": result["status"],
            "expertMaskFragments": e["expertFragmentsTotal"],
            "expertFragmentsWithoutOverlap": e["expertFragmentsWithZeroOverlap"],
            "modelMaskFragmentsWithoutOverlap": e["predictedFragmentsWithZeroOverlap"],
            "clinicalValidation": False
        }))
    except Exception as exc:
        print("ICH component audit failed: " + type(exc).__name__ + ": " +
              str(exc).split("/")[0][:120], file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
