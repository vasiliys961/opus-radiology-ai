from totalsegmentator_admission import ResourceEvidence,admission,GIB,MIB
SHA="a"*64
E=ResourceEvidence(SHA,5*GIB,"cpu-linux-reference",verified=True)

def run(e=E,ram=10*GIB,disk=10*GIB,dims=(512,512,103),sha=SHA,hardware="cpu-linux-reference",reserve=512*MIB):
    return admission(dims,ram,disk,e,sha,hardware,reserve)

def test_measured_admission_never_enables_inference():
    assert run()["canAdmit"] is True
    assert run()["inferenceEnabled"] is False

def test_missing_evidence_and_mismatch():
    assert run(e=None)["reason"]=="missing_verified_resource_evidence"
    assert run(sha="b"*64)["reason"]=="resource_evidence_mismatch"
    assert run(hardware="mac-m1-8gb")["reason"]=="resource_evidence_mismatch"

def test_8gb_machine_guard():
    r=run(ram=1305903104)
    assert r["reason"]=="insufficient_memory"
    assert r["requiredRamBytes"]==5*GIB+512*MIB

def test_disk_and_dimensions():
    assert run(disk=10)["reason"]=="insufficient_disk"
    assert run(dims=(512,512,301))["reason"]=="invalid_dimensions"
    assert run(dims=(512,512,True))["reason"]=="invalid_dimensions"

def test_bad_evidence_and_reserve():
    assert run(e=ResourceEvidence(SHA,0,"cpu-linux-reference",verified=True))["reason"]=="resource_evidence_mismatch"
    assert run(reserve=0)["reason"]=="invalid_resource_input"
