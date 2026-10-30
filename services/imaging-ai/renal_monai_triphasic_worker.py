#!/usr/bin/env python3
"""Loopback authenticated three-phase renal MONAI worker (research-only).

Receives a bounded ZIP with artery.nii.gz, vein.nii.gz, excret.nii.gz.
Original MONAI forward is delegated to the already audited research script.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import gzip
import shutil
import importlib.util
import json
import os
from pathlib import Path
import secrets
import signal
import sys
import tempfile
import zipfile

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

MODEL_SCRIPT=Path(__file__).resolve().parents[2]/"scripts"/"real-monai-renal-neoplasm-3phase.py"
NAMES=("artery.nii","vein.nii","excret.nii")
LIMIT=400*1024*1024
PACKAGE_LIMIT=3*LIMIT+1024*1024

def validate_archive(archive:Path,folder:Path):
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        if len(names)!=3 or set(names)!=set(NAMES):
            raise ValueError("three_named_registered_nifti_phases_required")
        for name in NAMES:
            info=z.getinfo(name)
            if info.file_size<1024 or info.file_size>LIMIT or info.compress_size>LIMIT:
                raise ValueError("unbounded_phase")
            if info.is_dir() or (info.external_attr>>16)&0o170000 in (0o120000,0o040000):
                raise ValueError("untrusted_archive_entry")
            target=folder/name
            with z.open(info) as src,target.open("xb") as dst:
                total=0
                while block:=src.read(1024*1024):
                    total+=len(block)
                    if total>LIMIT:raise ValueError("unbounded_phase")
                    dst.write(block)
    result={}
    for name in NAMES:
        source=folder/name
        output=folder/(name+".gz")
        with source.open("rb") as inp,gzip.open(output,"wb",compresslevel=1) as out:
            shutil.copyfileobj(inp,out,length=1024*1024)
        source.unlink()
        result[name]=output
    return result

def verify_model(checkpoint:Path):
    if checkpoint.is_symlink() or not checkpoint.is_file():
        raise ValueError("publisher_checkpoint_missing")
    spec=importlib.util.spec_from_file_location("real_renal_monai",MODEL_SCRIPT)
    if spec is None or spec.loader is None:raise ValueError("genuine_renal_executor_missing")
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module.original_checkpoint(checkpoint)

def create_app(*,token:str,checkpoint:Path):
    if len(token)<32:raise ValueError("worker_token_required")
    model=verify_model(checkpoint)
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    lock=asyncio.Lock()
    @app.middleware("http")
    async def auth(request:Request,handler):
        if request.client is None or request.client.host not in ("127.0.0.1","::1") or request.headers.get("host")!="127.0.0.1:8782":
            return JSONResponse({"detail":"loopback_only"},status_code=403)
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401)
        response=await handler(request)
        response.headers["Cache-Control"]="no-store"
        return response
    @app.get("/v1/renal/capabilities")
    async def capabilities():
        return {"schema":"opus-real-renal-monai-worker/v1","ready":True,
                "modelCheckpointSha256":model["checkpointSHA256"],
                "requiredPhases":list(NAMES),"singlePhaseSupported":False,
                "originalWeightsVerified":True}
    @app.post("/v1/renal/analyze")
    async def analyze(request:Request):
        if lock.locked():raise HTTPException(409,"renal_model_busy")
        if request.headers.get("x-opus-three-phase-research")!="authorized-registered-kidney-roi":
            raise HTTPException(403,"three_phase_research_approval_required")
        expected=request.headers.get("x-opus-source-sha256","")
        if len(expected)!=64 or any(ch not in "0123456789abcdef" for ch in expected):
            raise HTTPException(422,"source_sha_required")
        async with lock:
            with tempfile.TemporaryDirectory(prefix="opus-monai-renal-") as temp:
                root=Path(temp);archive=root/"phases.zip";hashing=hashlib.sha256();total=0
                with archive.open("xb") as out:
                    async for part in request.stream():
                        total+=len(part)
                        if total>PACKAGE_LIMIT:raise HTTPException(413,"phase_archive_too_large")
                        hashing.update(part);out.write(part)
                if hashing.hexdigest()!=expected:raise HTTPException(422,"source_digest_mismatch")
                try:phases=validate_archive(archive,root)
                except (ValueError,zipfile.BadZipFile):
                    raise HTTPException(422,"invalid_phase_archive") from None
                # The source-grid check must precede an expensive original forward.
                spec=importlib.util.spec_from_file_location("renal_grid",MODEL_SCRIPT)
                module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
                try:module.source_grid({"artery":phases[NAMES[0]],"vein":phases[NAMES[1]],"excret":phases[NAMES[2]]})
                except ValueError:raise HTTPException(422,"unregistered_native_phase_grids") from None
                report=root/"result.json";mask=root/"mask.nii.gz"
                cmd=[sys.executable,str(MODEL_SCRIPT),"--artery",str(phases[NAMES[0]]),
                     "--vein",str(phases[NAMES[1]]),"--excretory",str(phases[NAMES[2]]),
                     "--checkpoint",str(checkpoint),"--out-mask",str(mask),"--report",str(report),
                     "--approved-public-three-phase-ROI","--isolated-research-worker"]
                process=await asyncio.create_subprocess_exec(*cmd,stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,start_new_session=True)
                try:
                    await asyncio.wait_for(process.wait(),timeout=2400)
                    if process.returncode or not report.is_file():raise HTTPException(503,"real_renal_forward_failed")
                    data=json.loads(report.read_text())
                    if (data.get("schema")!="opus-original-MONAI-renal-CECT-neoplasm-3phase/v1" or
                        data.get("checkpointSHA256")!=model["checkpointSHA256"] or
                        data.get("originalPretrainedInferenceCompleted") is not True or
                        data.get("threeRegisteredPhasesUsed") is not True):
                        raise HTTPException(503,"inference_evidence_mismatch")
                    return {"schema":"opus-renal-monai-http-result/v1","sourceArchiveSHA256":expected,"report":data}
                except asyncio.TimeoutError:raise HTTPException(504,"renal_forward_timeout") from None
                finally:
                    if process.returncode is None:
                        try:os.killpg(process.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        await process.wait()
    return app

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--checkpoint",type=Path,required=True)
    args=parser.parse_args()
    token=secrets.token_urlsafe(36)
    app=create_app(token=token,checkpoint=args.checkpoint)
    print("Renal research worker bearer token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=8782,access_log=False)

if __name__=="__main__":main()
