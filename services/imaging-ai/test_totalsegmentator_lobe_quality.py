import pytest
from totalsegmentator_result import lobe_completeness_review

def test_missing_two_lobes_requires_review():
    qc=lobe_completeness_review({10:251,11:1094,12:0,13:0,14:2504})
    assert qc["status"]=="requires_review"
    assert qc["missingLabelIds"]==[12,13]
    assert qc["presentLabelCount"]==3
    assert qc["expectedLabelCount"]==5
    assert qc["fullAnatomicCoverageVerified"] is False
    assert qc["referenceDiceMeasured"] is False

def test_all_present_is_still_not_clinically_validated():
    qc=lobe_completeness_review({10:1,11:1,12:1,13:1,14:1})
    assert qc["status"]=="not_clinically_verified"
    assert qc["missingLabelIds"]==[]
    assert qc["referenceDiceMeasured"] is False

def test_limited_roi_only_reviews_requested_labels():
    assert lobe_completeness_review({10:42})["expectedLabelCount"]==1

@pytest.mark.parametrize("counts", [{},{10:-1},{10:1.0},{999:1},{10:True}])
def test_invalid_counts_cannot_produce_quality_review(counts):
    with pytest.raises(ValueError,match="invalid_label_set"):
        lobe_completeness_review(counts)
