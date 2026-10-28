#!/usr/bin/env python3
"""Local-only authentic WMH FLAIR inference from the exact opened DICOM series.

The browser explicitly sends a rights-cleared public study; worker validates each
DICOM, decodes native MR signal, runs the installed pinned original model and
returns a source-bound report. No mock/LLM inference or patient-cloud upload.
"""
from __future__ import annotations
import argparse,asyncio,hashlib,json,os,secrets,shutil,sys,tempfile
from pathlib import Path
from types import SimpleNamespace
import importlib.util
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse,Response

MAX_BYTES=256*1024**2
ROOT=Path(__file__).resolve().parents[2]

def load_script(path):
    spec=importlib.util.spec_from_file_location(path.stem.replace("-","_"),path)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

def create_app(*,token,origin,model_dir,checkpoint_sha256,port=8772):
    if sys.platform!="linux" or not 1024<=port<=65535:raise ValueError("private_linux_worker_required")
    if not isinstance(token,str) or not 32<=len(token)<=128:raise ValueError("session_token_required")
    if not (origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:")):
        raise ValueError("local_browser_origin_required")
    converter=load_script(ROOT/"services/imaging-ai/brain_flair_dicom_to_nifti.py")
    engine=load_script(ROOT/"scripts/real-brain-flair-wmh-cpu.py")
    engine.original_model(Path(model_dir),checkpoint_sha256)
    lock=asyncio.Lock()
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    @app.middleware("http")
    async def auth(request:Request,call_next):
        headers={"Access-Control-Allow-Origin":origin,"Vary":"Origin","Cache-Control":"no-store"}
        if request.headers.get("host")!=f"127.0.0.1:{port}" or request.headers.get("origin")!=origin:
            return JSONResponse({"detail":"origin_or_host_denied"},status_code=403)
        if request.method=="OPTIONS":
            if request.headers.get("access-control-request-method") not in ("GET","POST"):
                return Response(status_code=403,headers=headers)
            headers.update({"Access-Control-Allow-Methods":"GET,POST",
              "Access-Control-Allow-Headers":"Authorization,Content-Type",
              "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=headers)
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401,headers=headers)
        result=await call_next(request);result.headers.update(headers);return result
    @app.get("/v1/wmh/capabilities")
    async def capability():
        return {"schema":"opus-direct-wmh-worker/v1","modelId":"jinghangli98/wmh_seg",
          "originalModelReady":True,"checkpointSha256":checkpoint_sha256,
          "dataPolicy":"approved-public-research-only","patientMode":False,
          "imageUpload":True,"modelVersion":engine.VERSION}
    @app.post("/v1/wmh/analyze")
    async def analyze(request:Request):
        if lock.locked():raise HTTPException(409,"worker_busy")
        if int(request.headers.get("content-length","0") or "0")>MAX_BYTES:
            raise HTTPException(413,"source_exceeds_256MB")
        async with lock:
            with tempfile.TemporaryDirectory(prefix="opus-original-wmh-") as tmp:
                base=Path(tmp);source=base/"dicom";source.mkdir();result_dir=base/"result";result_dir.mkdir()
                form=await request.form(max_files=512,max_fields=4,max_part_size=16*1024**2)
                try:
                    if form.get("confirmed")!="yes" or form.get("publicRights")!="yes":
                        raise HTTPException(403,"public_deidentified_FLAIR_authorization_required")
                    url=form.get("sourceUrl");rights=form.get("sourceLicense")
                    if not isinstance(url,str) or not url.startswith("https://") or not isinstance(rights,str) or not rights.strip():
                        raise HTTPException(400,"public_source_provenance_required")
                    items=form.getlist("dicom")
                    if not 8<=len(items)<=512:raise HTTPException(400,"complete_MR_series_required")
                    total=0
                    for i,item in enumerate(items):
                        if not hasattr(item,"read"):raise HTTPException(400,"invalid_DICOM_upload")
                        p=source/f"{i:04d}.dcm"
                        with p.open("xb") as dest:
                            while True:
                                chunk=await item.read(128*1024)
                                if not chunk:break
                                total+=len(chunk)
                                if total>MAX_BYTES:raise HTTPException(413,"MRI_source_exceeds_limit")
                                dest.write(chunk)
                    def execute():
                        nifti=result_dir/"flair.nii.gz"
                        conversion=converter.convert_flair(source,nifti,protocol_confirmed=True)
                        inference=engine.execute(SimpleNamespace(
                            flair=nifti,flair_sha256=conversion["sourceFLAIRSHA256"],
                            model_dir=Path(model_dir),checkpoint_sha256=checkpoint_sha256,
                            mask_out=result_dir/"mask.nii.gz",public_source_url=url,
                            public_source_license=rights,approved_public_research=True,
                            flair_protocol_confirmed=True,rss_limit_gib=6.0,timeout_sec=2400,
                            expert=None,expert_sha256=None))
                        return {"conversion":conversion,"inference":inference}
                    try:return await asyncio.to_thread(execute)
                    except Exception as exc:
                        # Never leak paths, source metadata or PHI in errors.
                        raise HTTPException(422,"original_WMH_execution_failed") from exc
                finally:await form.close()
    return app

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--model-dir",type=Path,required=True)
    p.add_argument("--checkpoint-sha256",required=True)
    p.add_argument("--origin",default="http://127.0.0.1:3000")
    p.add_argument("--port",type=int,default=8772)
    a=p.parse_args()
    token=secrets.token_urlsafe(36).replace("-","_")
    app=create_app(token=token,origin=a.origin,model_dir=a.model_dir,
      checkpoint_sha256=a.checkpoint_sha256,port=a.port)
    print("WMH research worker session token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=a.port,access_log=False)
if __name__=="__main__":main()
