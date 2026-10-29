#!/usr/bin/env python3
"""Live loopback HTTP smoke: one TRUE published NIH DenseNet121 XRV forward.

No mocked inference. Uses the publisher's publicly licensed nonpatient sample
and published original trained checkpoint. No patient DICOM or cloud API calls.
All sample and weight paths must already have been SHA verified by CI.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SAMPLE_SHA="c8cbe59e6b9b186060dc68e63965658fa6b5b3ada6648d25c189b8b69b43cd4c"
WEIGHT_SHA="31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf"
PORT=8779
ORIGIN="http://127.0.0.1:3000"
SOURCE_URL="https://github.com/mlmed/torchxrayvision/tree/main/tests"
PATHOLOGIES={
    "Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema","Mass"
}


def file_digest(path:Path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for piece in iter(lambda:stream.read(1024*1024),b""):
            h.update(piece)
    return h.hexdigest()


def request(path:str,token:str,*,payload=None,source_sha=SAMPLE_SHA,
            origin=ORIGIN,content_type="image/png",authorized=True,timeout=20):
    headers={"Origin":origin,"Authorization":"Bearer "+token}
    if payload is not None:
        headers["Content-Type"]=content_type
        headers["X-Opus-PNG-SHA256"]=source_sha
        headers["X-Opus-Public-Source-URL"]=SOURCE_URL
    if not authorized:
        headers["Authorization"]="Bearer "+"wrong"*12
    req=Request("http://127.0.0.1:"+str(PORT)+path,headers=headers,
                data=payload,method="POST" if payload is not None else "GET")
    try:
        with urlopen(req,timeout=timeout) as response:
            return response.status,json.load(response)
    except HTTPError as error:
        # No PHI or original DICOM is ever attached to these requests.
        return error.code,json.load(error)


def ensure_real_public_workflow(sample:Path,weights:Path,script:Path):
    assert file_digest(sample)==SAMPLE_SHA,"original_public_source_sha_mismatch"
    assert file_digest(weights)==WEIGHT_SHA,"original_training_weight_sha_mismatch"
    assert sample.stat().st_size>1024
    assert script.is_file() and script.name=="cxr_xrv_direct_worker.py"
    token=secrets.token_urlsafe(36)
    env=os.environ.copy()
    env["OPUS_XRV_WORKER_TOKEN"]=token
    worker=subprocess.Popen([
        sys.executable,str(script),"--weights",str(weights),
        "--port",str(PORT),"--origin",ORIGIN,
    ],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        capability=None
        for _ in range(100):
            if worker.poll() is not None:
                raise AssertionError("original_worker_exited_before_readiness")
            try:
                code,body=request("/v1/cxr/capabilities",token,timeout=2)
                if code==200:
                    capability=body
                    break
            except (OSError,ValueError,URLError):
                pass
            time.sleep(.2)
        assert capability is not None,"original_model_worker_not_ready"
        assert capability["schema"]=="opus-original-xrv-cxr-worker/v1"
        assert capability["weightSha256"]==WEIGHT_SHA
        assert capability["originalCheckpointVerified"] is True
        assert capability["ready"] is True
        assert capability["patientMode"] is False
        assert set(capability["modelLabels"])==PATHOLOGIES

        image=sample.read_bytes()
        assert request("/v1/cxr/analyze",token,payload=image,
                       authorized=False)[0]==401
        assert request("/v1/cxr/analyze",token,payload=image,
                       origin="https://unauthorized.example")[0]==403
        assert request("/v1/cxr/analyze",token,payload=image,
                       source_sha="0"*64)[0]==422
        assert request("/v1/cxr/analyze",token,payload=image,
                       content_type="application/dicom")[0]==415

        code,result=request("/v1/cxr/analyze",token,payload=image,timeout=270)
        assert code==200,f"genuine trained forward did not complete, HTTP {code}: {result.get('detail','')}"
        assert result["schema"]=="opus-original-xrv-cxr-six-head/v1"
        assert result["sourcePngSha256"]==SAMPLE_SHA
        assert result["modelWeightSha256"]==WEIGHT_SHA
        assert result["actualPretrainedModelForwardCompleted"] is True
        assert result["patientMode"] is False
        assert result["clinicalValidation"] is False
        assert result["scoresAreCalibratedProbabilities"] is False
        assert result["spatialLocalizationSupported"] is False
        assert result["negativeDiagnosisPermitted"] is False
        assert set(result["labels"])==PATHOLOGIES
        assert all(type(v) in (float,int) and 0<=v<=1 for v in result["labels"].values())
        # Assert our actual model completed; never claim diagnostic accuracy.
        print(json.dumps({"schema":"opus-real-xrv-loopback-smoke/v1",
            "actualOriginalPretrainedForward":True,
            "sourceSha256":SAMPLE_SHA,"weightSha256":WEIGHT_SHA,
            "sixOriginalHeads":sorted(PATHOLOGIES),
            "positivePatientInterpretation":False,
            "clinicalAccuracyMeasured":False}))
    finally:
        if worker.poll() is None:
            os.killpg(worker.pid,signal.SIGTERM)
            try:
                worker.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(worker.pid,signal.SIGKILL)
                worker.wait(timeout=5)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--image",type=Path,required=True)
    p.add_argument("--weights",type=Path,required=True)
    p.add_argument("--worker",type=Path,default=Path(__file__).resolve().parents[1]/
                   "services/imaging-ai/cxr_xrv_direct_worker.py")
    a=p.parse_args()
    ensure_real_public_workflow(a.image,a.weights,a.worker)


if __name__=="__main__":
    main()
