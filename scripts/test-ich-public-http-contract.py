#!/usr/bin/env python3
"""ASGI browser preflight and authentication contract. NO genuine ICH forward.

Uses a byte-only fake public source and stub model verifier. This proves CORS
and route admission only, never clinical inference or installed checkpoints.
"""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from fastapi.testclient import TestClient

p=Path(__file__).resolve().parents[1]/"services/imaging-ai/ich_public_worker.py"
spec=importlib.util.spec_from_file_location("opus_public_ich_http_contract",p)
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class FixtureConverter:
    def authorize_series(self,folder,manifest):
        return sorted(folder.glob("fixture_*.dcm")),{"publicDataRightsReviewed":True}

class FixtureModel:
    MODEL_REV="e6d89c2"
    MODEL_FILES={"inference.py":("a"*64,1)}
    def verify_model_files(self,folder):
        # Synthetic readiness stub: no weight is downloaded or read.
        return None

worker.imported_script=lambda filename,module:(
    FixtureConverter() if filename=="prepare-ich-public-dicom-hu.py" else FixtureModel()
)

with TemporaryDirectory() as directory:
    root=Path(directory)
    dicom=root/"synthetic-source";dicom.mkdir()
    for i in range(8):
        (dicom/f"fixture_{i}.dcm").write_bytes(bytes([i+1])*256)
    authorization=root/"source-proof.json"
    authorization.write_text(json.dumps({"synthetic":True}),encoding="utf-8")
    token="A"*48
    approved="https://doctor-opus-ecg.vercel.app"
    app=worker.create_app(dicom_dir=dicom,public_manifest=authorization,
            model_dir=root/"uninstalled-mock",token=token,
            origin=approved,port=8766,scratch_dir=root)
    with TestClient(app,base_url="http://127.0.0.1:8766") as client:
        def request_headers(origin=approved,authenticated=True):
            result={"Origin":origin}
            if authenticated: result["Authorization"]="Bearer "+token
            return result
        wrong=client.get("/v1/ich/capabilities",headers=request_headers(
            "https://unapproved.example.org"))
        assert wrong.status_code==403
        assert wrong.headers.get("Access-Control-Allow-Origin") is None
        no_origin=client.get("/v1/ich/capabilities",
                             headers={"Authorization":"Bearer "+token})
        assert no_origin.status_code==403
        no_auth=client.get("/v1/ich/capabilities",
                           headers=request_headers(authenticated=False))
        assert no_auth.status_code==401
        assert no_auth.headers["Access-Control-Allow-Origin"]==approved
        bad_token=client.get("/v1/ich/capabilities",headers={
            "Origin":approved,"Authorization":"Bearer "+"B"*48})
        assert bad_token.status_code==401
        preflight=client.options("/v1/ich/jobs",headers={
            "Origin":approved,"Access-Control-Request-Method":"POST",
            "Access-Control-Request-Headers":"authorization,content-type",
            "Access-Control-Request-Private-Network":"true"})
        assert preflight.status_code==204
        assert preflight.headers["Access-Control-Allow-Origin"]==approved
        assert preflight.headers["Access-Control-Allow-Private-Network"]=="true"
        bad_preflight=client.options("/v1/ich/jobs",headers={
            "Origin":approved,"Access-Control-Request-Method":"POST",
            "Access-Control-Request-Headers":"cookie"})
        assert bad_preflight.status_code==403
        cap=client.get("/v1/ich/capabilities",headers=request_headers())
        assert cap.status_code==200
        assert cap.json()["schema"]=="opus-public-ich-worker/v1"
        assert cap.json()["patientMode"] is False
        assert cap.headers["Cache-Control"]=="no-store"
        bad_job=client.post("/v1/ich/jobs",headers=request_headers(),
            json={"schema":"opus-public-ich-job/v1","dataPolicy":"patient",
                  "originalDicomSha256":["0"*64]*8})
        assert bad_job.status_code==422
        assert "job" not in (bad_job.text.lower().split("detail")[0])
print("PASS real ASGI HTTP/CORS/auth/source rejection for exact HTTPS UI; mocked fixtures only")
