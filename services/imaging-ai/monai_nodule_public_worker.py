#!/usr/bin/env python3
"""Real pretrained MONAI RetinaNet source-bound on-demand research inference.

Browser may trigger original model on one independently approved public CT NIfTI
preinstalled on isolated Linux worker, keyed only by identical source SHA256.
No uploaded pixels, patient-mode, fabricated model outputs or DICOM SOP binding.
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
from urllib.parse import urlsplit
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
import psutil

ROOT=Path(__file__).resolve().parents[2]
MODEL="monai-lung-nodule-ct-retinanet"
MODEL_VERSION="0.6.9"
MAX_REPORT=1024*1024
MIN_FREE=9*1024**3


def original_runner():
    spec=importlib.util.spec_from_file_location("opus_original_monai_bound",
        Path(__file__).with_name("monai_bound_nodule.py"))
    if spec is None or spec.loader is None:
        raise ValueError("missing_original_monai_model_executor")
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_origin(origin):
    import re
    if not isinstance(origin,str) or len(origin)>255:
        raise ValueError("exact_ui_origin_required")
    try:
        u=urlsplit(origin)
        port=u.port
    except ValueError as e:
        raise ValueError("bad_ui_origin") from e
    host=u.hostname
    loopback=host in ("127.0.0.1","localhost")
    https=u.scheme=="https" and isinstance(host,str) and "." in host and all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?",x)
        for x in host.split("."))
    if (not ((u.scheme=="http" and loopback and port is not None) or https) or
        u.path or u.query or u.fragment or u.username or u.password or
        u.geturl()!=origin or "*" in origin):
        raise ValueError("exact_ui_origin_required")


def checked_request(body,expected_sha):
    if (not isinstance(body,dict) or set(body)!={"schema","sourceSha256","dataPolicy"} or
        body["schema"]!="opus-monai-nodule-request/v1" or
        body["dataPolicy"]!="approved-public-reference-only" or
        body["sourceSha256"]!=expected_sha):
        raise ValueError("different_or_nonpublic_study_denied")


def create_app(*,source,admission,bundle,token,origin,port=8767,scratch=None):
    if sys.platform!="linux" or not 1024<=port<=65535:
        raise ValueError("isolated_linux_worker_required")
    check_origin(origin)
    if not isinstance(token,str) or not 32<=len(token)<=128:
        raise ValueError("random_session_bearer_required")
    runner=original_runner()
    source,admission,bundle=map(Path,(source,admission,bundle))
    source_meta=runner.original_nifti(source)
    runner.source_admission(admission,source_meta)
    expected_sha=source_meta["sourceSha256"]
    expected_manifest_sha=runner.digest(admission)
    model_file=bundle/"models/model.pt"
    # Pinned actual publisher bytes, NOT just a path existing or modelReady:true.
    model_sha=runner.MODEL_SHA
    if bundle.is_symlink() or model_file.is_symlink() or not model_file.is_file():
        raise ValueError("official_monai_bundle_checkpoint_missing")
    if runner.digest(model_file)!=model_sha:
        raise ValueError("published_monai_retinanet_checkpoint_changed")
    if not (bundle/"configs/inference.json").is_file() or not (
        bundle/"configs/metadata.json").is_file() or not (
        bundle/"scripts/detection_inferer.py").is_file():
        raise ValueError("original_bundle_incomplete")
    metadata=json.loads((bundle/"configs/metadata.json").read_text())
    if (metadata.get("version")!=MODEL_VERSION or
        metadata.get("intended_use")!="This is an example, not to be used for diagnostic purposes"):
        raise ValueError("nonoriginal_or_diagnostic_monai_model_claim")
    config=json.loads((bundle/"configs/inference.json").read_text())
    if (config.get("num_classes")!=1 or config.get("infer_patch_size")!=[512,512,192] or
        config.get("postprocessing",{}).get("transforms",[])[1].get("_target_")!="AffineBoxToWorldCoordinated" or
        config.get("postprocessing",{}).get("transforms",[])[1].get("affine_lps_to_ras") is not True or
        config.get("preprocessing",{}).get("transforms",[])[1].get("affine_lps_to_ras") is not True):
        raise ValueError("official_monai_source_geometry_pipeline_changed")
    scratch=Path(scratch) if scratch else Path(tempfile.gettempdir())
    if not scratch.is_dir() or scratch.is_symlink():
        raise ValueError("private_existing_scratch_directory_required")
    root=Path(tempfile.mkdtemp(prefix="opus-live-monai-",dir=scratch))
    root.chmod(0o700)
    state={"job":None}

    async def dispose(job):
        if job is None:return
        await job["spawnReady"].wait()
        p=job.get("proc")
        if p is not None and p.returncode is None:
            try:os.killpg(p.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            await p.wait()
        task=job.get("task")
        if task is not None and task is not asyncio.current_task():
            task.cancel()
            try:await task
            except asyncio.CancelledError:pass
        shutil.rmtree(job["dir"],ignore_errors=True)

    @asynccontextmanager
    async def lifespan(app):
        try:yield
        finally:
            await dispose(state["job"])
            shutil.rmtree(root,ignore_errors=True)

    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

    @app.middleware("http")
    async def private_auth(request:Request,call_next):
        headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if (request.headers.get("host")!=f"127.0.0.1:{port}" or
            request.headers.get("origin")!=origin):
            return JSONResponse({"detail":"unapproved_origin_or_host"},status_code=403,headers=headers)
        headers.update({"Access-Control-Allow-Origin":origin,"Vary":"Origin"})
        if request.method=="OPTIONS":
            requested=set(v.strip().lower() for v in
                request.headers.get("access-control-request-headers","").split(",") if v.strip())
            if (request.headers.get("access-control-request-method") not in
                {"GET","POST","DELETE"} or
                not requested.issubset({"authorization","content-type"})):
                return Response(status_code=403,headers=headers)
            headers.update({"Access-Control-Allow-Methods":"GET,POST,DELETE",
                            "Access-Control-Allow-Headers":"Authorization,Content-Type",
                            "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=headers)
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"invalid_session"},status_code=401,headers=headers)
        answer=await call_next(request)
        answer.headers.update(headers)
        return answer

    @app.get("/v1/nodule/capabilities")
    async def capabilities():
        return {
            "schema":"opus-monai-live-worker/v1","modelId":MODEL,
            "modelVersion":MODEL_VERSION,"checkpointSha256":model_sha,
            "modelRevision":runner.MODEL_REPO_REV,"originalWeightsVerified":True,
            "mode":"local","dataPolicy":"approved-public-reference-only",
            "sourceFormat":"original-nifti-uncompressed","patientMode":False,
            "imageUpload":False,"ready":psutil.virtual_memory().available>=MIN_FREE,
            "unvalidatedResearch":True,
        }

    async def infer(job):
        try:
            args=[sys.executable,str(Path(__file__).with_name("monai_bound_nodule.py")),
                "--source",str(source),"--admission",str(admission),
                "--bundle",str(bundle),"--work",str(job["dir"]/"working"),
                "--output",str(job["dir"]/"model-report.json"),
                "--authorization",runner.AUTH]
            env={k:v for k,v in os.environ.items() if k in
                ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH")}
            env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1",
                        "HF_HUB_DISABLE_TELEMETRY":"1","OMP_NUM_THREADS":"2",
                        "MKL_NUM_THREADS":"2","TORCH_FORCE_WEIGHTS_ONLY_LOAD":"1"})
            try:
                p=await asyncio.create_subprocess_exec(*args,
                    cwd=str(ROOT),stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,env=env,start_new_session=True)
                job["proc"]=p
            finally:
                job["spawnReady"].set()
            try:
                await asyncio.wait_for(p.wait(),timeout=3600)
            except asyncio.TimeoutError:
                job["reason"]="real_monai_forward_timed_out"
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                await p.wait()
                job["state"]="failed"
                return
            if p.returncode:
                job["state"]="failed";job["reason"]="real_pretrained_monai_model_forward_failed";return
            result_path=job["dir"]/"model-report.json"
            if not result_path.is_file() or not 250<result_path.stat().st_size<=MAX_REPORT:
                raise ValueError("model_output_not_present")
            result=json.loads(result_path.read_text())
            if (result.get("schema")!="opus-monai-bound-nodule-inference/v1" or
                result.get("source",{}).get("sha256")!=expected_sha or
                result.get("model",{}).get("weightsSha256")!=model_sha or
                result.get("execution",{}).get("actualPretrainedInferenceCompleted") is not True or
                result.get("clinicalStatus")!="unverified_research_draft" or
                result.get("clinicallyValidated") is not False or
                result.get("negativeDiagnosisAllowed") is not False):
                raise ValueError("real_monai_report_source_or_model_unverified")
            if (runner.digest(source)!=expected_sha or
                runner.digest(admission)!=expected_manifest_sha or
                runner.digest(model_file)!=model_sha):
                raise ValueError("preapproved_original_model_or_input_changed")
            job["report"]=result;job["state"]="succeeded"
        except Exception:
            job["state"]="failed";job["reason"]="no_verified_genuine_model_result"
        finally:
            job["spawnReady"].set()

    def job_for(jid):
        job=state["job"]
        if job is None or not secrets.compare_digest(job["id"],jid):
            raise HTTPException(404,"nodule_job_not_found")
        return job

    @app.post("/v1/nodule/jobs",status_code=201)
    async def submit(request:Request):
        if state["job"] is not None:
            raise HTTPException(409,"previous_job_must_be_deleted")
        if psutil.virtual_memory().available<MIN_FREE:
            raise HTTPException(507,"original_monai_cpu_requires_nine_gib_free_ram")
        payload=await request.body()
        if len(payload)>1024:raise HTTPException(413,"source_manifest_too_large")
        try:
            checked_request(json.loads(payload),expected_sha)
            if (runner.digest(source)!=expected_sha or
                runner.digest(admission)!=expected_manifest_sha or
                runner.digest(model_file)!=model_sha):
                raise ValueError("source_or_checkpoint_drift")
        except (ValueError,TypeError,KeyError,json.JSONDecodeError):
            raise HTTPException(422,"nonapproved_or_changed_public_study") from None
        directory=root/str(uuid.uuid4())
        directory.mkdir(mode=0o700)
        job={"id":directory.name,"dir":directory,"state":"running",
             "report":None,"proc":None,"spawnReady":asyncio.Event()}
        state["job"]=job
        job["task"]=asyncio.create_task(infer(job))
        return {"schema":"opus-monai-job/v1","jobId":job["id"],"state":"running"}

    @app.get("/v1/nodule/jobs/{jid}")
    async def progress(jid:str):
        job=job_for(jid)
        return {"schema":"opus-monai-job/v1","jobId":job["id"],
                "state":job["state"],"reason":job.get("reason")}

    @app.get("/v1/nodule/jobs/{jid}/report")
    async def report(jid:str):
        job=job_for(jid)
        if job["state"]!="succeeded" or job["report"] is None:
            raise HTTPException(409,"original_monai_report_not_ready")
        return job["report"]

    @app.delete("/v1/nodule/jobs/{jid}")
    async def cancel(jid:str):
        job=job_for(jid)
        await dispose(job)
        state["job"]=None
        return {"deleted":True}
    return app


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--admission",type=Path,required=True)
    p.add_argument("--bundle",type=Path,required=True)
    p.add_argument("--origin",default="http://localhost:3000")
    p.add_argument("--port",type=int,default=8767)
    p.add_argument("--token-env",default="OPUS_MONAI_NODULE_WORKER_TOKEN")
    p.add_argument("--scratch",type=Path)
    args=p.parse_args()
    token=os.environ.get(args.token_env)
    if not token:raise SystemExit("Set a random session token (>=32 characters) in environment")
    app=create_app(source=args.source,admission=args.admission,
        bundle=args.bundle,origin=args.origin,port=args.port,
        token=token,scratch=args.scratch)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=args.port,access_log=False,log_level="warning")


if __name__=="__main__":
    main()
