#!/usr/bin/env python3
"""Private CLN upload worker: original uncompressed browser HU NIfTI -> actual nnU-Net.
Research-only; pinned original weights, bounded upload/RAM/time and no cloud transfer.
"""
from __future__ import annotations
import asyncio, gzip, hashlib, importlib.util, json, os, shutil, tempfile, uuid
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
import psutil

MODEL_SHA=os.environ.get("OPUS_CLN_CHECKPOINT_SHA256","")
MODEL_ROOT=Path(os.environ.get("OPUS_CLN_MODEL_ROOT","/nonexistent"))
TOKEN=os.environ.get("OPUS_CLN_WORKER_TOKEN","")
ORIGIN=os.environ.get("OPUS_CLN_WORKER_ORIGIN","http://127.0.0.1:3000")
PORT=8783
MAX_UPLOAD=352+512*512*300*4
def script():
    path=Path(__file__).resolve().parents[2]/"scripts/cln-msd-original-ct-cpu.py"
    spec=importlib.util.spec_from_file_location("opus_cln_true_forward",path)
    obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj)
    return obj
def ready():
    if not TOKEN or len(TOKEN)<32 or len(MODEL_SHA)!=64 or psutil.virtual_memory().available<12*1024**3:
        return False
    try:
        m=script()
        weight=MODEL_ROOT/m.TASK/m.TRAINER/"fold_0/checkpoint_best.pth"
        return weight.is_file() and m.sha256(weight)==MODEL_SHA and shutil.which("nnUNetv2_predict") is not None
    except Exception:return False
def create_app():
    store={}
    root=Path(tempfile.mkdtemp(prefix="opus-cln-private-"))
    @asynccontextmanager
    async def lifespan(app):
        try:yield
        finally:
            for job in store.values():
                task=job.get("task")
                if task and not task.done():task.cancel()
            shutil.rmtree(root,ignore_errors=True)
    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    @app.middleware("http")
    async def guard(req,call_next):
        if req.headers.get("host")!=f"127.0.0.1:{PORT}" or req.headers.get("origin")!=ORIGIN or req.headers.get("authorization")!="Bearer "+TOKEN or len(TOKEN)<32:
            return JSONResponse({"detail":"unauthorized"},status_code=403)
        return await call_next(req)
    @app.get("/v1/cln/capabilities")
    async def capabilities():
        return {"schema":"opus-original-cln-upload-worker/v1","modelId":"Lab-Rasool/CLN-Segmenter-MSD-fold0",
                "originalWeightsVerified":ready(),"imageUpload":True,"researchOnly":True,"patientMode":False,
                "checkpointSha256":MODEL_SHA}
    async def compute(job,nii):
        from argparse import Namespace
        try:
            gz=job["dir"]/"case.nii.gz"
            with nii.open("rb") as inp,gz.open("xb") as dest:
                with gzip.GzipFile(filename="",fileobj=dest,mode="wb",mtime=0) as stream:
                    while block:=inp.read(1024*1024):stream.write(block)
            m=script()
            checksum=m.sha256(gz)
            result=await asyncio.to_thread(m.infer,Namespace(
                approved_public_source=True,ct=gz,source_sha256=checksum,
                model_dir=MODEL_ROOT,checkpoint_sha256=MODEL_SHA,
                output=job["dir"]/"prediction",expert=None,memory_gib=11,timeout_sec=3300))
            if not result.get("realOriginalModelForwardCompleted"):raise ValueError("forward_not_completed")
            if result["modelComponentsTruncated"]:raise ValueError("candidate_list_truncated")
            job["report"]={"schema":"opus-original-cln-upload-result/v1",
                "sourceNiftiSha256":job["sourceHash"],"realOriginalModelForwardCompleted":True,
                "checkpointSha256":MODEL_SHA,"candidateCount":result["modelTumorComponentCount"],
                "nativeCandidates":result["sourceNativeTumorCandidates"],"researchOnly":True,
                "clinicalValidation":False,"negativeDiagnosisPermitted":False}
            job["state"]="succeeded"
        except Exception as exc:
            job["state"]="failed";job["reason"]=type(exc).__name__
        finally:nii.unlink(missing_ok=True)
    @app.post("/v1/cln/upload")
    async def upload(req:Request):
        if not ready():raise HTTPException(503,"model_unavailable")
        sha=req.headers.get("x-opus-source-sha256","")
        if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
            raise HTTPException(400,"source_sha_required")
        if req.headers.get("x-opus-public-research-authorization")!="approved-nonpatient-source":
            raise HTTPException(403,"public_research_only")
        if any(j["state"]=="running" for j in store.values()):raise HTTPException(409,"CLN_busy")
        folder=root/str(uuid.uuid4());folder.mkdir(mode=0o700)
        nii=folder/"source.nii";n=0;h=hashlib.sha256()
        try:
            with nii.open("xb") as output:
                async for chunk in req.stream():
                    n+=len(chunk)
                    if n>MAX_UPLOAD:raise HTTPException(413,"too_large")
                    h.update(chunk);output.write(chunk)
            if n<352 or h.hexdigest()!=sha:raise HTTPException(422,"source_mismatch")
            # An actual 3D source NIfTI must contain the native NIfTI-1 signature.
            with nii.open("rb") as inp:
                header=inp.read(352)
            if int.from_bytes(header[:4],"little")!=348 or header[344:348]!=b"n+1\\x00":
                raise HTTPException(422,"invalid_native_nifti")
            jobId=str(uuid.uuid4());job={"state":"running","sourceHash":sha,"dir":folder}
            store[jobId]=job
            job["task"]=asyncio.create_task(compute(job,nii))
            return {"schema":"opus-cln-job/v1","jobId":jobId,"state":"running"}
        except BaseException:
            shutil.rmtree(folder,ignore_errors=True);raise
    @app.get("/v1/cln/jobs/{jobId}")
    async def state(jobId:str):
        if jobId not in store:raise HTTPException(404)
        j=store[jobId]
        return {"schema":"opus-cln-job/v1","jobId":jobId,"state":j["state"],"reason":j.get("reason")}
    @app.get("/v1/cln/jobs/{jobId}/report")
    async def report(jobId:str):
        if jobId not in store or store[jobId]["state"]!="succeeded":raise HTTPException(404)
        return store[jobId]["report"]
    @app.delete("/v1/cln/jobs/{jobId}")
    async def delete(jobId:str):
        j=store.pop(jobId,None)
        if j:
            task=j.get("task")
            if task and not task.done():task.cancel()
            shutil.rmtree(j["dir"],ignore_errors=True)
        return {"deleted":True}
    return app
app=create_app()
if __name__=="__main__":
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=PORT)
