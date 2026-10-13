"""Synthetic-only abdomen checks; real MSD dataset tested by opt-in Action."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile

import nibabel as nib
import numpy as np
import pytest

from totalsegmentator_audit import ABDOMEN_ORGANS, RESEARCH_CT_PROFILES
from totalsegmentator_result import validate_native_mask

ROOT=Path(__file__).resolve().parents[2]

def module(filename):
    spec=importlib.util.spec_from_file_location("module_"+filename.replace("-","_"),
        ROOT/"scripts"/filename)
    loaded=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

prep=module("prepare-msd-spleen-abdomen.py")
score=module("score-msd-spleen-abdomen.py")
run=module("run-totalseg-first-inference.py")

def fixtures(tmp_path,bad_truth_geometry=False):
    arr=np.full((4,3,3),40,dtype=np.int16)
    affine=np.diag([1.,2.,3.,1.])
    image=tmp_path/"image.nii.gz"
    gt=tmp_path/"gt.nii.gz"
    truth=np.zeros(arr.shape,dtype=np.uint8)
    truth[1,1,1]=1
    nib.save(nib.Nifti1Image(arr,affine),str(image))
    bad=affine.copy()
    if bad_truth_geometry:bad[0,3]=3.
    nib.save(nib.Nifti1Image(truth,bad),str(gt))
    archive=tmp_path/"Task09_Spleen.tar"
    with tarfile.open(archive,"w") as tar:
        for folder,filename in (("imagesTr",image),("labelsTr",gt)):
            tar.add(filename,arcname=f"Task09_Spleen/{folder}/spleen_2.nii.gz")
    out=tmp_path/"msd"
    digest=hashlib.md5(archive.read_bytes()).hexdigest()
    return archive,out,digest

def verified(tmp_path):
    archive,out,digest=fixtures(tmp_path)
    manifest=prep.prepare(archive,out,expected_md5=digest)
    prediction=out/"prediction.nii"
    img=nib.load(str(out/"public_abdomen_ct.nii"))
    data=np.zeros(img.shape,dtype=np.uint8)
    data[1,1,1]=1;data[2,1,1]=5
    nib.save(nib.Nifti1Image(data,img.affine),str(prediction))
    # The raw offline validator normalizes images into strict 352+count uint8
    # NIfTI and binds LPS geometry. No fake Dice beyond these isolated tests.
    report=out/"model-report.json"
    report.write_text(json.dumps({
        "schema":"opus-totalseg-first-inference/v1",
        "sourceSha256":manifest["inputSha256"],
        "maskSha256":score.sha(prediction),
        "status":"completed_unvalidated",
    }))
    return out,prediction,report

def test_official_class_ids_and_research_only_profiles():
    assert ABDOMEN_ORGANS=={1:"spleen",2:"kidney_right",3:"kidney_left",5:"liver"}
    assert RESEARCH_CT_PROFILES["lung-lobes"][10]=="lung_upper_lobe_left"
    assert not set(ABDOMEN_ORGANS)&set(RESEARCH_CT_PROFILES["lung-lobes"])

def test_pinned_archive_and_reference_label_contract(tmp_path):
    archive,out,digest=fixtures(tmp_path)
    with pytest.raises(ValueError,match="digest"):
        prep.prepare(archive,out)
    manifest=prep.prepare(archive,out,expected_md5=digest)
    assert manifest["dimensions"]==[4,3,3]
    assert manifest["independentReferenceOnlyFor"]==["spleen"]
    assert manifest["liverKidneysReferenceAvailable"] is False
    assert (out/"public_abdomen_ct.nii").exists()

def test_reject_reference_geometry_mismatch_and_cleanup(tmp_path):
    archive,out,digest=fixtures(tmp_path,bad_truth_geometry=True)
    with pytest.raises(ValueError,match="reference_geometry"):
        prep.prepare(archive,out,expected_md5=digest)
    assert not out.exists()

def test_independent_spleen_dice_numeric_and_no_other_ground_truth(tmp_path):
    folder,pred,report=verified(tmp_path)
    result=score.score(folder,pred,report)
    assert result["spleen"]["dice"]==1.0
    assert result["spleen"]["referenceVoxels"]==1
    assert len(result["otherOrgans"])==3
    assert all(x["dice"] is None for x in result["otherOrgans"])
    assert result["readyForClinicalUse"] is False

def test_tampered_ct_or_spleen_reference_blocks_scoring(tmp_path):
    folder,pred,report=verified(tmp_path)
    ct=folder/"public_abdomen_ct.nii"
    ct.write_bytes(ct.read_bytes()+b"x")
    with pytest.raises(ValueError,match="binding"):
        score.score(folder,pred,report)

def test_reject_wrong_task_before_any_container_execution(tmp_path):
    with pytest.raises(ValueError,match="unsupported_research_profile"):
        run.prepare(tmp_path/"none",tmp_path/"none",tmp_path/"none",profile="brain-mr")

def test_manual_workflow_does_not_run_in_default_ci_or_upload_patient_data():
    w=(ROOT/".github/workflows/totalseg-msd-abdomen-public-ct.yml").read_text()
    assert "workflow_dispatch:" in w
    assert "push:" not in w and "pull_request:" not in w
    assert "upload-artifact" not in w
    assert w.index("--research-profile abdomen-four-organs")<w.index("score-msd-spleen-abdomen.py")
    assert "Task09_Spleen.tar" in w
    assert "Remove all public image volumes" in w
