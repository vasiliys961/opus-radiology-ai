"""Synthetic numerical fixtures only: not independent clinical performance."""
import importlib.util
from pathlib import Path
import pytest

p = Path(__file__).with_name("nodule_reference_matching.py")
spec = importlib.util.spec_from_file_location("nodule_reference_matching", p)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def candidate(x, score=0.9):
    return {"centerMm": [x, 0, 0], "score": score}

def nodule(x, diameter=8):
    return {"centerMm": [x, 0, 0], "diameterMm": diameter}

def test_one_to_one_matching_duplicates_and_missing_lesion():
    result = module.match_one_case(
        candidates=[candidate(0), candidate(1), candidate(50), candidate(20, 0.1)],
        nodules=[nodule(0), nodule(20)], threshold=0.5, coordinates_verified=True)
    assert result["detectedNodules"] == 1
    assert result["missedReferenceIndices"] == [1]
    assert result["falsePositives"] == 2
    assert result["matches"][0]["centerErrorMm"] == 0

def test_empty_negative_scan_counts_false_positives():
    result = module.match_one_case(candidates=[candidate(0)], nodules=[],
                                   threshold=0.2, coordinates_verified=True)
    assert result["falsePositives"] == 1
    assert result["referenceNodules"] == 0

def test_cohort_aggregation_single_threshold_not_full_froc():
    cases = [
        {"caseId": "positive", "coordinatesVerified": True,
         "candidates": [candidate(0), candidate(40)], "nodules": [nodule(0)]},
        {"caseId": "negative", "coordinatesVerified": True,
         "candidates": [candidate(4)], "nodules": []},
    ]
    output = module.evaluate_cohort(cases, threshold=0.5, independent_holdout=True)
    assert output["lesionSensitivity"] == 1
    assert output["falsePositivesPerScan"] == 1
    assert output["specificity"] is None
    assert output["clinicalValidation"] is False

def test_no_performance_claim_without_independent_holdout():
    with pytest.raises(ValueError, match="independent_holdout"):
        module.evaluate_cohort([], threshold=0.5)

def test_no_matching_in_unverified_coordinate_frame():
    with pytest.raises(ValueError, match="coordinate_frame"):
        module.match_one_case(candidates=[candidate(0)], nodules=[nodule(0)], threshold=0.5)

@pytest.mark.parametrize("score", [-0.1, 1.01, float("nan"), True])
def test_invalid_model_confidences_fail(score):
    with pytest.raises(ValueError, match="invalid_score"):
        module.match_one_case(candidates=[candidate(0, score)], nodules=[],
                              threshold=0.5, coordinates_verified=True)

def test_duplicate_case_id_refused():
    item = {"caseId": "same", "coordinatesVerified": True,
            "candidates": [], "nodules": []}
    with pytest.raises(ValueError, match="duplicate"):
        module.evaluate_cohort([item, item], threshold=0.5, independent_holdout=True)
