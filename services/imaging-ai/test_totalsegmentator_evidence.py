import pytest
from totalsegmentator_evidence import prepare_evidence,inspect_research_mask

def test_missing_audit_and_fake_checkpoint():
    r=prepare_evidence("absent", [512,512,10], [1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.],
                       "a"*64, None, "a"*64)
    assert not r["accepted"] and r["reason"]=="missing_install_audit"

def test_local_shas_cannot_claim_provenance():
    audit={"schema":"opus-totalsegmentator-install-audit/v1","canRun":False,
           "adapterConnected":False,"files":[
              {"file":f"dataset_{i}/{j}","status":"present-unverified","sha256":"a"*64}
              for i in (297,298) for j in ("plans.json","dataset.json","fold_0/checkpoint_final.pth")]}
    r=prepare_evidence("absent",[4,4,4],[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.],
                       "b"*64,audit,"a"*64)
    assert not r["accepted"] and r["reason"]=="independent_provenance_not_connected"

def test_wrong_audit_cannot_enable_handoff():
    a={"schema":"opus-totalsegmentator-install-audit/v1","canRun":True,"adapterConnected":True}
    r=prepare_evidence("absent",[4,4,4],[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.],"a"*64,a,"a"*64)
    assert not r["accepted"] and r["reason"]=="invalid_audit_state"

def test_unknown_roi_rejected_before_file_read():
    with pytest.raises(ValueError,match="unsupported_roi"):
        inspect_research_mask("absent",[4,4,4],[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.],"a"*64,["unknown"])
