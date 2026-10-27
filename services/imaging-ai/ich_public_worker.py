"""Isolated original ianpan ICH public-reference worker; loopback/tunnel only.

No patient images are accepted. Browser sends hashes, never image pixels; the
operator has already provisioned an approved public source on the worker host.
The original pinned trained model runs in a killable separate process and
private on-disk results are removed after use. Not clinically validated.
"""
from __future__ import annotations

import argparse
import asyncio
from contextlib import asynccontextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import sys
import tempfile
import uuid
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
import psutil

SCHEMA="opus-public-ich-worker/v1"
MAX_RUNTIME_SECONDS=3600
MAX_EVIDENCE_BYTES=1024*1024
MIN_FREE_MEMORY=10*1024**3
SCRIPTS=Path(__file__).resolve().parents[2]/"scripts"


def imported_script(name, module):
    spec=importlib.util.spec_from_file_location(module,SCRIPTS/name)
    if spec is None or spec.loader is None:
        raise ValueError("missing_original_ich_script")
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj


def check_origin(origin):
    u=urlsplit(origin)
    if (u.scheme!="http" or u.hostname not in {"127.0.0.1","localhost"} or
        not u.port or u.path or u.query or u.fragment or u.username or u.password):
        raise ValueError("exact_local_ui_origin_required")


def digest_file(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for data in iter(lambda:f.read(1024*1024),b""):
            h.update(data)
    return h.hexdigest()


def source_manifest_sha(converter,dicom_dir,manifest):
    files,proof=converter.authorize_series(dicom_dir,manifest)
    return sorted(digest_file(p) for p in files),proof


def checked_job_input(payload,expected):
    if (not isinstance(payload,dict) or
        set(payload)!={"schema","dataPolicy","originalDicomSha256"} or
        payload["schema"]!="opus-public-ich-job/v1" or
        payload["dataPolicy"]!="public-reference-only" or
        not isinstance(payload["originalDicomSha256"],list) or
        len(payload["originalDicomSha256"])!=len(expected) or
        any(not isinstance(v,str) or len(v)!=64 or
            any(c not in "0123456789abcdef" for c in v)
            for v in payload["originalDicomSha256"]) or
        sorted(payload["originalDicomSha256"])!=expected):
        raise ValueError("opened_dicom_does_not_match_preapproved_public_reference")


def create_app(*,dicom_dir,public_manifest,model_dir,token,origin,
               port=8766,scratch_dir=None):
    if sys.platform!="linux":
        raise ValueError("linux_isolated_research_host_required")
    check_origin(origin)
    if not 1024<=port<=65535 or not secrets.token_urlsafe(1):
        raise ValueError("bad_worker_configuration")
    if not isinstance(token,str) or not 32<=len(token)<=128:
        raise ValueError("random_worker_token_required")
    dicom_dir,public_manifest,model_dir=map(Path,(dicom_dir,public_manifest,model_dir))
    converter=imported_script("prepare-ich-public-dicom-hu.py","ich_converter")
    original=imported_script("run-ianpan-ich-research.py","original_ich_ianpan")
    expected,_=source_manifest_sha(converter,dicom_dir,public_manifest)
    # This is a real byte-for-byte model asset check, not a Python mock.
    try:
        original.verify_model_files(model_dir)
        trained_model_ready=True
    except (ValueError,OSError):
        trained_model_ready=False
    scratch=Path(scratch_dir) if scratch_dir else Path(tempfile.gettempdir())
    if scratch.is_symlink() or not scratch.is_dir():
        raise ValueError("invalid_worker_scratch_root")
    root=Path(tempfile.mkdtemp(prefix="opus-ich-private-",dir=scratch))
    root.chmod(0o700)
    current={"job":None}

    async def cleanup(job):
        if not job:return
        p=job.get("process")
        if p and p.returncode is None:
            try:os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            await p.wait()
        task=job.get("task")
        if task and task is not asyncio.current_task():
            task.cancel()
            try:await task
            except asyncio.CancelledError:pass
        shutil.rmtree(job["directory"],ignore_errors=True)

    @asynccontextmanager
    async def lifespan(app):
        try:yield
        finally:
            await cleanup(current["job"])
            shutil.rmtree(root,ignore_errors=True)

    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

    @app.middleware("http")
    async def local_boundary(request:Request,call_next):
        headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if request.headers.get("host")!=f"127.0.0.1:{port}" or request.headers.get("origin")!=origin:
            return JSONResponse({"detail":"origin_or_host_denied"},status_code=403,headers=headers)
        headers["Access-Control-Allow-Origin"]=origin
        headers["Vary"]="Origin"
        if request.method=="OPTIONS":
            methods={"GET","POST","DELETE"}
            names={x.strip().lower() for x in request.headers.get("access-control-request-headers","").split(",") if x.strip()}
            if (request.headers.get("access-control-request-method") not in methods or
                not names.issubset({"authorization","content-type"})):
                return Response(status_code=403,headers=headers)
            headers.update({"Access-Control-Allow-Methods":"GET,POST,DELETE",
                            "Access-Control-Allow-Headers":"Authorization,Content-Type",
                            "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=headers)
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401,headers=headers)
        response=await call_next(request)
        response.headers.update(headers)
        return response

    @app.get("/v1/ich/capabilities")
    async def capabilities():
        return {"schema":SCHEMA,"mode":"local","modelId":"ianpan/ct-head-hemorrhage-detection",
                "modelRevision":original.MODEL_REV,"modelAssetsSha256":{k:v[0] for k,v in original.MODEL_FILES.items()},
                "modelReady":trained_model_ready,"dataPolicy":"public-reference-only",
                "patientMode":False,"inputTransfer":"hashes-only-preapproved-public-study",
                "maxSlices":64,"minFreeRamBytes":MIN_FREE_MEMORY,
                "resourceReady":psutil.virtual_memory().available>=MIN_FREE_MEMORY,
                "unvalidatedResearch":True}

    async def infer(job):
        try:
            cmd=[sys.executable,str(SCRIPTS/"run-public-ich-dicom-evidence.py"),
                 "--dicom-dir",str(dicom_dir),"--public-manifest",str(public_manifest),
                 "--model-dir",str(model_dir),"--output-dir",str(job["directory"]/"result"),
                 "--device","cpu","--authorization","PUBLIC-HEAD-NCCT-RESEARCH-OK"]
            env={k:v for k,v in os.environ.items() if k in {"PATH","HOME","TMPDIR","LD_LIBRARY_PATH"}}
            env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1",
                        "HF_HUB_DISABLE_TELEMETRY":"1","OMP_NUM_THREADS":"2","OPENBLAS_NUM_THREADS":"1",
                        "PYTHONUNBUFFERED":"1"})
            proc=await asyncio.create_subprocess_exec(*cmd,cwd=str(SCRIPTS.parent),
                                                       stdout=asyncio.subprocess.DEVNULL,
                                                       stderr=asyncio.subprocess.DEVNULL,
                                                       env=env,start_new_session=True)
            job["process"]=proc
            try:
                await asyncio.wait_for(proc.wait(),timeout=MAX_RUNTIME_SECONDS)
            except asyncio.TimeoutError:
                try:os.killpg(proc.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                await proc.wait()
                job["state"]="failed"
                job["reason"]="model_timeout"
                return
            if proc.returncode!=0:
                job["state"]="failed"
                job["reason"]="original_trained_inference_failed"
                return
            path=job["directory"]/"result"/"private-native-evidence.json"
            if not path.is_file() or not 0<path.stat().st_size<=MAX_EVIDENCE_BYTES:
                raise ValueError("missing_or_oversized_actual_evidence")
            evidence=json.loads(path.read_text(encoding="utf-8"))
            if (evidence.get("schema")!="opus-evidence/v1" or
                evidence.get("modality")!="CT" or
                evidence.get("coverage")=="assessed" or
                any(f.get("model",{}).get("provider")!="local" for f in evidence.get("findings",[]))):
                raise ValueError("invalid_genuine_evidence_contract")
            job["state"]="succeeded"
            job["evidence"]=evidence
        except Exception:
            job["state"]="failed"
            job["reason"]="inference_or_provenance_validation_failed"

    @app.post("/v1/ich/jobs",status_code=201)
    async def create_job(request:Request):
        if current["job"] is not None:
            raise HTTPException(409,"previous_job_must_be_deleted")
        if not trained_model_ready:
            raise HTTPException(503,"original_model_weights_not_ready")
        if psutil.virtual_memory().available<MIN_FREE_MEMORY:
            raise HTTPException(507,"isolated_worker_needs_10gib_available_ram")
        body=await request.body()
        if len(body)>8192:
            raise HTTPException(413,"unbounded_job_manifest")
        try:
            payload=json.loads(body)
            checked_job_input(payload,expected)
            # A second source byte check at execution time; no image bytes accepted.
            source_manifest_sha(converter,dicom_dir,public_manifest)
        except (ValueError,TypeError,KeyError,json.JSONDecodeError):
            raise HTTPException(422,"source_manifest_or_authorized_public_rights_failed") from None
        job_dir=root/str(uuid.uuid4())
        job_dir.mkdir(mode=0o700)
        job={"id":job_dir.name,"directory":job_dir,"state":"running","evidence":None,"process":None}
        current["job"]=job
        job["task"]=asyncio.create_task(infer(job))
        return {"schema":"opus-public-ich-job-status/v1","jobId":job["id"],"state":"running"}

    def lookup(job_id):
        job=current["job"]
        if job is None or not secrets.compare_digest(job["id"],job_id):
            raise HTTPException(404,"job_not_found")
        return job

    @app.get("/v1/ich/jobs/{job_id}")
    async def status(job_id:str):
        job=lookup(job_id)
        return {"schema":"opus-public-ich-job-status/v1","jobId":job["id"],
                "state":job["state"],"reason":job.get("reason")}

    @app.get("/v1/ich/jobs/{job_id}/evidence")
    async def evidence(job_id:str):
        job=lookup(job_id)
        if job["state"]!="succeeded" or job["evidence"] is None:
            raise HTTPException(409,"model_evidence_not_ready")
        return job["evidence"]

    @app.delete("/v1/ich/jobs/{job_id}")
    async def delete(job_id:str):
        job=lookup(job_id)
        await cleanup(job)
        current["job"]=None
        return {"deleted":True}

    return app


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-dir",type=Path,required=True)
    p.add_argument("--public-manifest",type=Path,required=True)
    p.add_argument("--model-dir",type=Path,required=True)
    p.add_argument("--origin",default="http://localhost:3000")
    p.add_argument("--port",type=int,default=8766)
    p.add_argument("--scratch-dir",type=Path)
    p.add_argument("--token-env",default="OPUS_ICH_WORKER_TOKEN")
    a=p.parse_args()
    token=os.environ.get(a.token_env)
    if not token:raise SystemExit("Set a random >=32-character token in the selected environment variable")
    app=create_app(dicom_dir=a.dicom_dir,public_manifest=a.public_manifest,
                   model_dir=a.model_dir,origin=a.origin,port=a.port,token=token,
                   scratch_dir=a.scratch_dir)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=a.port,log_level="warning",access_log=False)


if __name__=="__main__":
    main()
