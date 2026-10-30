#!/usr/bin/env python3
"""Authenticated loopback KS987 single-phase renal inference worker."""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import sys
import tempfile
from fastapi import FastAPI,HTTPException,Request
from fastapi.responses import JSONResponse

MAX_BYTES=1600*1024**2
SCRIPT=Path(__file__).with_name("ks987_native_kidney_executor.py")
def model_module():
    spec=importlib.util.spec_from_file_location("ks987_worker_model",SCRIPT)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod.original()

def create_app(*,token:str,results:Path,device:str="cpu",port:int=8783):
    if not isinstance(token,str) or len(token)<32 or not 1024<=port<=65535:
        raise ValueError("loopback_auth_required")
    if device not in ("cpu","cuda"):raise ValueError("unsupported_device")
    model=model_module()
    official=model.check_official_checkpoint(results,"kidney")
    if official["checkpointMatchesRealVerifiedPublisherBytes"] is not True:
        raise ValueError("publisher_KS987_checkpoint_mismatch")
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    lock=asyncio.Lock()
    @app.middleware("http")
    async def auth(request:Request,handler):
        if request.headers.get("host")!=f"127.0.0.1:{port}" or not request.client or request.client.host not in ("127.0.0.1","::1"):
            return JSONResponse({"detail":"loopback_only"},status_code=403)
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401)
        response=await handler(request)
        response.headers["Cache-Control"]="no-store"
        return response
    @app.get("/v1/ks987/capabilities")
    async def capabilities():
        return {"schema":"opus-original-ks987-kidney-worker/v1",
            "ready":model.available_gib()>=64,
            "checkpointSHA256":official["originalCheckpointSha256"],
            "originalWeightsVerified":True,"modality":"CT","region":"ABDOMEN"}
    @app.post("/v1/ks987/analyze")
    async def analyze(request:Request):
        if lock.locked():raise HTTPException(409,"busy")
        if request.headers.get("content-type")!="application/octet-stream" or request.headers.get("x-opus-research-authorized")!="authorized-nonpatient":
            raise HTTPException(403,"research_authorization_required")
        sha=request.headers.get("x-opus-source-sha256","")
        if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
            raise HTTPException(422,"source_sha_required")
        async with lock:
            with tempfile.TemporaryDirectory(prefix="opus-real-ks987-") as temp:
                root=Path(temp);source=root/"original.nii";h=hashlib.sha256();n=0
                with source.open("xb") as output:
                    async for part in request.stream():
                        n+=len(part)
                        if n>MAX_BYTES:raise HTTPException(413,"native_volume_too_large")
                        h.update(part);output.write(part)
                if n<1024 or h.hexdigest()!=sha:
                    raise HTTPException(422,"native_source_hash_mismatch")
                report=root/"evidence.json"
                cmd=[sys.executable,str(SCRIPT),"--source",str(source),
                    "--nnunet-results",str(results),"--output",str(report),
                    "--device",device,"--authorized-original-research"]
                proc=await asyncio.create_subprocess_exec(*cmd,stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,start_new_session=True)
                try:
                    await asyncio.wait_for(proc.wait(),timeout=7600)
                    if proc.returncode or not report.is_file() or report.stat().st_size>1024*1024:
                        raise HTTPException(503,"original_KS987_forward_not_completed")
                    data=json.loads(report.read_text())
                    if (data.get("schema")!="opus-ks987-native-kidney-forward/v1" or
                        data.get("sourceNiftiSha256")!=sha or
                        data.get("originalCheckpointSHA256")!=official["originalCheckpointSha256"] or
                        data.get("originalModelForwardCompleted") is not True or
                        data.get("nativeGridVerified") is not True):
                        raise HTTPException(503,"model_evidence_mismatch")
                    return data
                except asyncio.TimeoutError:
                    raise HTTPException(504,"original_KS987_timeout") from None
                finally:
                    if proc.returncode is None:
                        try:os.killpg(proc.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        await proc.wait()
    return app

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--nnunet-results",type=Path,required=True)
    p.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    args=p.parse_args()
    token=secrets.token_urlsafe(36)
    app=create_app(token=token,results=args.nnunet_results,device=args.device)
    print("KS987 original worker bearer token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=8783,access_log=False)

if __name__=="__main__":main()
