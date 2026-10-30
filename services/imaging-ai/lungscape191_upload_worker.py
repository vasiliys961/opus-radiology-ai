#!/usr/bin/env python3
"""Authenticated loopback original LungSCAPE191 Dataset191 CT worker. Research only."""
from __future__ import annotations
import asyncio,gzip,hashlib,importlib.util,json,os,shutil,sys,tempfile,uuid
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI,Request,HTTPException
from fastapi.responses import JSONResponse
ROOT=Path(__file__).resolve().parents[2]
TOKEN=os.environ.get("OPUS_LUNGSCAPE_WORKER_TOKEN","")
ORIGIN=os.environ.get("OPUS_LUNGSCAPE_WORKER_ORIGIN","http://127.0.0.1:3000")
MODELS=Path(os.environ.get("OPUS_LUNGSCAPE_MODEL_ROOT","/not-installed"))
PORT=8784
MAX_BYTES=352+512*512*300*4
def model():
    sys.path.insert(0,str(ROOT/"scripts"))
    p=ROOT/"scripts/run-lungscape191-research.py"
    spec=importlib.util.spec_from_file_location("opus_lungscape_original",p)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def ready():
    dirs=list(MODELS.glob("Dataset191_*"))
    if len(dirs)!=1 or not shutil.which("nnUNetv2_predict"):return False
    trainers=list(dirs[0].glob("*__3d_fullres"))
    return len(trainers)==1 and (trainers[0]/"dataset.json").is_file() and all(
        (trainers[0]/f"fold_{i}/checkpoint_final.pth").is_file() for i in range(5))
def create_app():
    jobs={};root=Path(tempfile.mkdtemp(prefix="opus-lungscape-private-"))
    @asynccontextmanager
    async def lifespan(app):
        try:yield
        finally:
            for job in jobs.values():
                if job.get("task") and not job["task"].done():job["task"].cancel()
            shutil.rmtree(root,ignore_errors=True)
    app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)
    @app.middleware("http")
    async def auth(req,call_next):
        if (len(TOKEN)<32 or req.headers.get("host")!=f"127.0.0.1:{PORT}" or
            req.headers.get("origin")!=ORIGIN or req.headers.get("authorization")!="Bearer "+TOKEN):
            return JSONResponse({"detail":"forbidden"},status_code=403)
        return await call_next(req)
    @app.get("/v1/lungscape/capabilities")
    async def capabilities():
        return {"schema":"opus-lungscape-original-worker/v1","originalWeightsVerified":ready(),
          "modelId":"LungSCAPE Dataset191","researchOnly":True,"patientMode":False,"imageUpload":True}
    async def execute(job,path):
        try:
            src=job["dir"]/"input";src.mkdir()
            gz=src/"case_0000.nii.gz"
            with path.open("rb") as inp,gz.open("xb") as f:
                with gzip.GzipFile(fileobj=f,mode="wb",filename="",mtime=0) as target:
                    while chunk:=inp.read(1024*1024):target.write(chunk)
            result=await asyncio.to_thread(model().run,gz,MODELS,job["dir"]/"output",
                                           device="cpu",execute=True,fold=os.environ.get("OPUS_LUNGSCAPE_FOLD","all"))
            if result.get("trueOriginalTrainedModelForwardCompleted") is not True or result.get("status")!="research_mask_generated":
                raise ValueError("original_inference_not_completed")
            if result.get("originalMaskComponentAnalysisCompleted") is not True:
                raise ValueError("native_component_analysis_not_completed")
            components=result.get("originalMaskConnectedComponentsResearchOnly")
            if not isinstance(components,list) or len(components)>400:raise ValueError("unbounded_components")
            job["report"]={"schema":"opus-lungscape-original-CT-result/v1","sourceNiftiSha256":job["hash"],
                "realOriginalModelForwardCompleted":True,"model":"LungSCAPE Dataset191",
                "modelLabelMap":result.get("originalModelLabelMap"),
                "nativeComponents":components,"componentCount":len(components),
                "researchOnly":True,"clinicalValidation":False,"negativeDiagnosisPermitted":False}
            job["state"]="succeeded"
        except Exception as exc:
            job["state"]="failed";job["reason"]=type(exc).__name__
        finally:path.unlink(missing_ok=True)
    @app.post("/v1/lungscape/upload")
    async def upload(req:Request):
        if not ready():raise HTTPException(503,"original_weights_unavailable")
        if req.headers.get("x-opus-public-research-authorization")!="approved-nonpatient-source":raise HTTPException(403)
        expected=req.headers.get("x-opus-source-sha256","")
        if len(expected)!=64 or any(x not in "0123456789abcdef" for x in expected):raise HTTPException(422)
        if any(j["state"]=="running" for j in jobs.values()):raise HTTPException(409,"busy")
        folder=root/str(uuid.uuid4());folder.mkdir(mode=0o700)
        path=folder/"source.nii";size=0;h=hashlib.sha256()
        try:
            with path.open("xb") as f:
                async for chunk in req.stream():
                    size+=len(chunk)
                    if size>MAX_BYTES:raise HTTPException(413)
                    h.update(chunk);f.write(chunk)
            if size<352 or h.hexdigest()!=expected:raise HTTPException(422,"source_mismatch")
            with path.open("rb") as f:head=f.read(352)
            if int.from_bytes(head[:4],"little")!=348 or head[344:348]!=bytes([110,43,49,0]):
                raise HTTPException(422,"invalid_NIfTI")
            jid=str(uuid.uuid4());job={"dir":folder,"state":"running","hash":expected}
            jobs[jid]=job;job["task"]=asyncio.create_task(execute(job,path))
            return {"schema":"opus-lungscape-job/v1","jobId":jid,"state":"running"}
        except BaseException:
            shutil.rmtree(folder,ignore_errors=True);raise
    @app.get("/v1/lungscape/jobs/{jobId}")
    async def job(jobId:str):
        if jobId not in jobs:raise HTTPException(404)
        j=jobs[jobId]
        return {"schema":"opus-lungscape-job/v1","jobId":jobId,"state":j["state"],"reason":j.get("reason")}
    @app.get("/v1/lungscape/jobs/{jobId}/report")
    async def report(jobId:str):
        if jobId not in jobs or jobs[jobId]["state"]!="succeeded":raise HTTPException(404)
        return jobs[jobId]["report"]
    @app.delete("/v1/lungscape/jobs/{jobId}")
    async def delete(jobId:str):
        j=jobs.pop(jobId,None)
        if j:
            if j.get("task") and not j["task"].done():j["task"].cancel()
            shutil.rmtree(j["dir"],ignore_errors=True)
        return {"deleted":True}
    return app
app=create_app()
if __name__=="__main__":
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=PORT)
