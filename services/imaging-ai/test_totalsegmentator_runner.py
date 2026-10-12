import pytest
from totalsegmentator_runner import execute_research_ct, ModelUnavailable
DIMS=(4,4,3)
AFFINE=[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.]
SHA="a"*64
OK={k:True for k in ("research_only","source_permitted","weights_verified",
    "license_reviewed","network_isolated","worker_isolated")}
BUDGET={"canAdmit":True,"reason":"measured_budget_only","inferenceEnabled":False}

def call(tmp_path, auth=OK, budget=BUDGET, infer=None):
    source=tmp_path/"in.nii"
    source.write_bytes(b"dummy")
    return execute_research_ct(source,tmp_path/"out.nii",DIMS,AFFINE,SHA,
        authorization=auth,resource_decision=budget,infer=infer)

def test_refuses_missing_authorization(tmp_path):
    with pytest.raises(ModelUnavailable,match="authorization"):
        call(tmp_path,auth={})

def test_refuses_missing_budget(tmp_path):
    with pytest.raises(ModelUnavailable,match="resource"):
        call(tmp_path,budget={})

def test_refuses_offline_flag_missing(tmp_path):
    with pytest.raises(ModelUnavailable,match="authorization"):
        call(tmp_path,auth={**OK,"network_isolated":False})

def test_no_real_inference_until_isolation_connected(tmp_path):
    with pytest.raises(ModelUnavailable,match="isolated_execution_not_connected"):
        call(tmp_path)

def test_research_callable_requires_mask(tmp_path):
    calls=[]
    def fake(**kwargs): calls.append(kwargs)
    with pytest.raises(ModelUnavailable,match="missing_native_mask"):
        call(tmp_path,infer=fake)
    assert calls[0]["fast"] and calls[0]["device"]=="cpu"
    assert len(calls[0]["roi_subset"])==5

def test_invalid_fake_mask_removed(tmp_path):
    def fake(**kwargs): kwargs["output"].write_bytes(b"invalid")
    with pytest.raises(ValueError):
        call(tmp_path,infer=fake)
    assert not (tmp_path/"out.nii").exists()
