"""Numerical-only synthetic fixtures: do NOT represent clinical accuracy."""
import hashlib
import json
from pathlib import Path
import struct

import pytest
from totalsegmentator_dice import benchmark


def mask(path,values,origin=0):
    header=bytearray(352)
    struct.pack_into("<i",header,0,348)
    struct.pack_into("<4h",header,40,3,len(values),1,1)
    struct.pack_into("<hh",header,70,2,8)
    struct.pack_into("<f",header,108,352.)
    struct.pack_into("<hh",header,252,0,1)
    struct.pack_into("<12f",header,280,1.,0.,0.,float(origin),
                     0.,1.,0.,0.,0.,0.,1.,0.)
    header[344:348]=b"n+1\x00"
    path.write_bytes(header+bytes(values))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepared(tmp_path,pred,ref,origin_pred=0,origin_ref=0):
    prediction=tmp_path/"pred.nii"
    reference=tmp_path/"reference.nii"
    prediction_sha=mask(prediction,pred,origin_pred)
    reference_sha=mask(reference,ref,origin_ref)
    source="a"*64
    preport=tmp_path/"report.json"
    rmanifest=tmp_path/"reference.json"
    preport.write_text(json.dumps({
        "schema":"opus-totalseg-first-inference/v1",
        "status":"completed_unvalidated","sourceSha256":source,
        "maskSha256":prediction_sha}))
    rmanifest.write_text(json.dumps({
        "schema":"opus-totalseg-independent-reference/v1",
        "sourceSha256":source,"maskSha256":reference_sha,
        "independentAnnotationAttested":True,
        "annotationMethod":"curated_reference",
        "licensedForResearch":True}))
    return prediction,preport,reference,rmanifest


def test_dice_is_computed_per_lobe_without_inventing_absent_classes(tmp_path):
    inp=prepared(tmp_path,[10,10,11,0,0,13,0],
                            [10,0,11,12,0,0,0])
    result=benchmark(*inp)
    labels={x["labelId"]:x for x in result["lobeDice"]}
    assert labels[10]["dice"]==0.5
    assert labels[11]["dice"]==1.0
    assert labels[12]["dice"]==0.0
    assert labels[13]["dice"] is None
    assert labels[14]["dice"] is None
    assert result["macroDice"] is None
    assert result["allFiveReferenceLabelsPresent"] is False
    assert result["readyForClinicalUse"] is False


def test_complete_five_label_reference_can_report_macro(tmp_path):
    inp=prepared(tmp_path,[10,11,12,13,14,0],
                            [10,11,12,13,14,14])
    result=benchmark(*inp)
    assert result["macroDice"]==round((1+1+1+1+2/3)/5,6)
    assert result["allFiveReferenceLabelsPresent"] is True


def test_mismatched_grid_fails_before_scoring(tmp_path):
    inp=prepared(tmp_path,[10,11,12],[10,11,12],origin_ref=1)
    with pytest.raises(ValueError,match="geometry"):
        benchmark(*inp)


def test_self_comparison_rejected(tmp_path):
    inp=prepared(tmp_path,[10,11,12],[10,11,12])
    with pytest.raises(ValueError,match="non_independent"):
        benchmark(*inp)


def test_reference_binding_and_attestation_required(tmp_path):
    inp=prepared(tmp_path,[10,0,0],[11,0,0])
    manifest=inp[3]
    data=json.loads(manifest.read_text())
    data["independentAnnotationAttested"]=False
    manifest.write_text(json.dumps(data))
    with pytest.raises(ValueError,match="provenance"):
        benchmark(*inp)


def test_tampered_reference_rejected(tmp_path):
    inp=prepared(tmp_path,[10,0,0],[11,0,0])
    inp[2].write_bytes(inp[2].read_bytes()+b"junk")
    with pytest.raises(ValueError,match="reference_sha_mismatch"):
        benchmark(*inp)


def test_unexpected_label_rejected(tmp_path):
    inp=prepared(tmp_path,[10,0,0],[200,0,0])
    with pytest.raises(ValueError,match="unexpected_mask_label"):
        benchmark(*inp)
