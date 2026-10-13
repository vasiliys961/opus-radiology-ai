"""Lesion-level research evaluation on independently verified physical coordinates.

This module never executes a medical model. Scores may only be calculated after
source-to-reference registration is externally verified for every case.
"""
from __future__ import annotations
import math

def _point(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3 or any(
        type(x) not in (int, float) or not math.isfinite(x) for x in value
    ):
        raise ValueError("invalid_point")
    return tuple(float(x) for x in value)

def _distance(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))

def match_one_case(*, candidates, nodules, threshold, coordinates_verified=False):
    """One-to-one lesion matching at a score threshold.

    Reference nodules require centerMm and positive diameterMm in the SAME
    independently verified frame as candidate centerMm. A candidate counts as
    matching if inside the reference nodule radius. Predictions cannot match
    multiple nodules. Nonmatches are counted as false-positive candidates.
    """
    if coordinates_verified is not True:
        raise ValueError("coordinate_frame_not_independently_verified")
    if type(threshold) not in (int, float) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError("invalid_threshold")
    parsed = []
    for n in nodules:
        center = _point(n["centerMm"])
        diameter = n["diameterMm"]
        if type(diameter) not in (int, float) or not math.isfinite(diameter) or not 0 < diameter <= 100:
            raise ValueError("invalid_nodule_diameter")
        parsed.append((center, diameter / 2))
    accepted = []
    for index, candidate in enumerate(candidates):
        center = _point(candidate["centerMm"])
        score = candidate["score"]
        if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
            raise ValueError("invalid_score")
        if score >= threshold:
            accepted.append((index, center, float(score)))
    accepted.sort(key=lambda c: (-c[2], c[0]))
    matched = set()
    matches = []
    false_positives = []
    for index, center, score in accepted:
        possibilities = sorted(
            (_distance(center, ncenter), ref_index)
            for ref_index, (ncenter, radius) in enumerate(parsed)
            if ref_index not in matched and _distance(center, ncenter) <= radius
        )
        if possibilities:
            distance, ref_index = possibilities[0]
            matched.add(ref_index)
            matches.append({"candidateIndex": index, "referenceIndex": ref_index,
                            "centerErrorMm": distance, "score": score})
        else:
            false_positives.append(index)
    return {"referenceNodules": len(parsed), "detectedNodules": len(matched),
            "missedReferenceIndices": sorted(set(range(len(parsed))) - matched),
            "falsePositiveCandidateIndices": false_positives,
            "falsePositives": len(false_positives), "matches": matches}

def evaluate_cohort(cases, *, threshold, independent_holdout=False):
    """Aggregate FROC operating point only for an explicitly independent cohort."""
    if independent_holdout is not True:
        raise ValueError("independent_holdout_not_demonstrated")
    if not isinstance(cases, list) or not cases:
        raise ValueError("empty_cohort")
    seen = set()
    outcomes = []
    for case in cases:
        case_id = case["caseId"]
        if not isinstance(case_id, str) or not case_id or case_id in seen:
            raise ValueError("missing_or_duplicate_case_id")
        seen.add(case_id)
        if case.get("coordinatesVerified") is not True:
            raise ValueError("unverified_case_coordinates")
        outcomes.append(match_one_case(candidates=case["candidates"], nodules=case["nodules"],
                                       threshold=threshold, coordinates_verified=True))
    nlesions = sum(x["referenceNodules"] for x in outcomes)
    detected = sum(x["detectedNodules"] for x in outcomes)
    fp = sum(x["falsePositives"] for x in outcomes)
    return {"caseCount": len(outcomes), "referenceLesions": nlesions,
            "detectedLesions": detected, "falsePositiveCandidates": fp,
            "lesionSensitivity": detected / nlesions if nlesions else None,
            "falsePositivesPerScan": fp / len(outcomes),
            "specificity": None, "clinicalValidation": False,
            "metricScope": "single_threshold_FROC_operating_point_not_full_curve"}
