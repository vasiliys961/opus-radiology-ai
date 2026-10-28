#!/usr/bin/env python3
"""Private, opt-in browser-upload MONAI nodule worker for rights-cleared public CT.

Receives exact HU NIfTI through authenticated loopback; verifies SHA, geometry
and genuine publisher checkpoint; launches original pinned RetinaNet. Research only.
"""
from __future__ import annotations
import argparse,asyncio,hashlib,json,os,shutil,signal,sys,tempfile,uuid
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI,HTTPException,Request
from fastapi.responses import JSONResponse,Response
import psutil
from monai_nodule_public_worker import original_runner,check_origin,MODEL,MODEL_VERSION,MIN_FREE,MAX_REPORT
from monai_bound_nodule import MAX_INPUT,AUTH

def create_upload_app(*,bundle,token,origin,port=8768,scratch=None):
    if sys.platform!="linux" or not 1024<=port<=65535:raise ValueError("linux_worker_required")
    check_origin(origin)
    if not isinstance(token,str) or not 32<=len(token)<=128:raise ValueError("session_token_required")
    runner=original_runner()
    bundle=Path(bundle)
    model=bundle/"models/model.pt"
    if bundle.is_symlink() or model.is_symlink() or not model.is_file() or runner.digest(model)!=runner.MODEL_SHA:
        raise ValueError("original_monai_checkpoint_unverified")
    metadata=json.loads((bundle/"configs/metadata.json").read_text())
    cfg=json.loads((bundle/"configs/inference.json").read_text())
    if (metadata.get("version")!=MODEL_VERSION or
        metadata.get("intended_use")!="This is an example, not to be used for diagnostic purposes" or
        cfg.get("num_classes")!=1 or cfg.get("infer_patch_size")!=[512,512,192] or
        cfg.get("postprocessing",{}).get("transforms",[{},{}])[1].get("_target_")!="AffineBoxToWorldCoordinated" or
        cfg.get("postprocessing",{}).get("transforms",[{},{}])[1].get("affine_lps_to_ras") is not True or
        cfg.get("preprocessing",{}).get("transforms",[{},{}])[1].get("affine_lps_to_ras") is not True or
        not (bundle/"scripts/detection_inferer.py").is_file()):
        raise ValueError("original_monai_bundle_changed")
    scratch=Path(scratch) if scratch else Path(tempfile.gettempdir())
    if not scratch.is_dir() or scratch.is_symlink():raise ValueError("scratch_directory_required")
    root=Path(tempfile.mkdtemp(prefix="opus-upload-monai-",dir=scratch));root.chmod(0o700)
    state={"job":None}
    async def dispose(job):
        if job is None:return
        await job["started"].wait()
        p=job.get("process")
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
    app=FastAPI(lifespan=lifespan,docs_url=None,openapi_url=None,redoc_url=None)
    @app.middleware("http")
    async def authenticate(request:Request,call_next):
        headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if request.headers.get("host")!=f"127.0.0.1:{port}" or request.headers.get("origin")!=origin:
            return JSONResponse({"detail":"unapproved_origin_or_host"},status_code=403,headers=headers)
        headers.update({"Access-Control-Allow-Origin":origin,"Vary":"Origin"})
        if request.method=="OPTIONS":
            requested=set(x.strip().lower() for x in request.headers.get("access-control-request-headers","").split(",") if x.strip())
            if request.headers.get("access-control-request-method") not in {"GET","POST","DELETE"} or not requested.issubset({"authorization","content-type","x-opus-source-sha256"}):
                return Response(status_code=403,headers=headers)
            headers.update({"Access-Control-Allow-Methods":"GET,POST,DELETE","Access-Control-Allow-Headers":"Authorization,Content-Type,X-Opus-Source-Sha256","Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=headers)
        import secrets
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"invalid_session"},status_code=401,headers=headers)
        result=await call_next(request);result.headers.update(headers);return result
    @app.get("/v1/nodule/capabilities")
    async def capabilities():
        return {"schema":"opus-monai-live-worker/v1","modelId":MODEL,"modelVersion":MODEL_VERSION,
            "checkpointSha256":runner.MODEL_SHA,"modelRevision":runner.MODEL_REPO_REV,
            "originalWeightsVerified":True,"mode":"local","dataPolicy":"approved-public-reference-only",
            "sourceFormat":"original-nifti-uncompressed","patientMode":False,"imageUpload":True,
            "ready":psutil.virtual_memory().available>=MIN_FREE,"unvalidatedResearch":True}
    async def infer(job):
        try:
            args=[sys.executable,str(Path(__file__).with_name("monai_bound_nodule.py")),
                "--source",str(job["source"]),"--admission",str(job["admission"]),
                "--bundle",str(bundle),"--work",str(job["dir"]/"working"),
                "--output",str(job["dir"]/"result.json"),"--authorization",AUTH]
            env={k:v for k,v in os.environ.items() if k in ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH")}
            env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1","HF_HUB_DISABLE_TELEMETRY":"1",
                "OMP_NUM_THREADS":"2","MKL_NUM_THREADS":"2","TORCH_FORCE_WEIGHTS_ONLY_LOAD":"1"})
            try:
                p=await asyncio.create_subprocess_exec(*args,stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL,cwd=str(Path(__file__).resolve().parents[2]),
                    env=env,start_new_session=True)
                job["process"]=p
            finally:job["started"].set()
            try:await asyncio.wait_for(p.wait(),3600)
            except asyncio.TimeoutError:
                job["reason"]="original_model_timeout"
                try:os.killpg(p.pid,signal.SIGKILL)
                except ProcessLookupError:pass
                await p.wait();job["state"]="failed";return
            if p.returncode:raise ValueError("original_model_forward_failed")
            result_file=job["dir"]/"result.json"
            if not result_file.is_file() or not 250<result_file.stat().st_size<=MAX_REPORT:
                raise ValueError("invalid_model_output")
            result=json.loads(result_file.read_text())
            if (result.get("schema")!="opus-monai-bound-nodule-inference/v1" or
                result.get("source",{}).get("sha256")!=job["sha"] or
                result.get("model",{}).get("weightsSha256")!=runner.MODEL_SHA or
                result.get("execution",{}).get("actualPretrainedInferenceCompleted") is not True or
                runner.digest(job["source"])!=job["sha"] or
                runner.digest(model)!=runner.MODEL_SHA):
                raise ValueError("model_output_source_or_weights_mismatch")
            job["result"]=result;job["state"]="succeeded"
        except Exception:
            job["state"]="failed";job["reason"]="original_monai_forward_not_verified"
        finally:job["started"].set()
    def current(jid):
        j=state["job"]
        if j is None or j["id"]!=jid:raise HTTPException(404,"nodule_job_not_found")
        return j
    @app.post("/v1/nodule/upload",status_code=201)
    async def upload(request:Request):
        if state["job"] is not None:raise HTTPException(409,"previous_job_must_be_deleted")
        if psutil.virtual_memory().available<MIN_FREE:raise HTTPException(507,"original_monai_requires_nine_gib_free_ram")
        sha=request.headers.get("x-opus-source-sha256","")
        if len(sha)!=64 or any(c not in "0123456789abcdef" for c in sha):
            raise HTTPException(422,"source_sha256_required")
        if request.headers.get("content-type")!="application/octet-stream":
            raise HTTPException(415,"original_nifti_bytes_required")
        folder=root/str(uuid.uuid4());folder.mkdir(mode=0o700)
        source=folder/"input.nii";h=hashlib.sha256();size=0
        try:
            with source.open("xb") as stream:
                async for chunk in request.stream():
                    size+=len(chunk)
                    if size>MAX_INPUT:raise HTTPException(413,"ct_too_large")
                    h.update(chunk);stream.write(chunk)
            if size<352 or h.hexdigest()!=sha:raise HTTPException(422,"source_hash_mismatch")
            try:meta=runner.original_nifti(source)
            except (ValueError,TypeError):raise HTTPException(422,"invalid_original_hu_nifti") from None
            if meta["sourceSha256"]!=sha:raise HTTPException(422,"source_changed")
            admission=folder/"admission.json"
            admission.write_text(json.dumps({"schema":"opus-public-chest-nodule-admission/v1",
                "sourceNiftiSha256":sha,"modality":"CT","anatomy":"CHEST",
                "intensity":"original-HU","publicOrRightsClearedData":True,
                "containsPatientData":False,"fullSelectedSeriesPresent":True}))
            runner.source_admission(admission,meta)
            job={"id":folder.name,"dir":folder,"source":source,"admission":admission,
                 "sha":sha,"state":"running","result":None,"process":None,
                 "started":asyncio.Event()}
            state["job"]=job
            job["task"]=asyncio.create_task(infer(job))
            return {"schema":"opus-monai-job/v1","jobId":job["id"],"state":"running"}
        except BaseException:
            shutil.rmtree(folder,ignore_errors=True)
            raise
    @app.get("/v1/nodule/jobs/{jid}")
    async def progress(jid:str):
        j=current(jid)
        return {"schema":"opus-monai-job/v1","jobId":jid,"state":j["state"],"reason":j.get("reason")}
    @app.get("/v1/nodule/jobs/{jid}/report")
    async def report(jid:str):
        j=current(jid)
        if j["state"]!="succeeded" or j["result"] is None:raise HTTPException(409,"report_not_ready")
        return j["result"]
    @app.delete("/v1/nodule/jobs/{jid}")
    async def cancel(jid:str):
        j=current(jid);await dispose(j);state["job"]=None;return {"deleted":True}
    return app

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--bundle",type=Path,required=True)
    p.add_argument("--origin",default="http://localhost:3000")
    p.add_argument("--port",type=int,default=8768)
    p.add_argument("--token-env",default="OPUS_MONAI_NODULE_WORKER_TOKEN")
    p.add_argument("--scratch",type=Path)
    a=p.parse_args();token=os.environ.get(a.token_env)
    if not token:raise SystemExit("Set random session token in environment")
    import uvicorn
    uvicorn.run(create_upload_app(bundle=a.bundle,origin=a.origin,port=a.port,token=token,scratch=a.scratch),
        host="127.0.0.1",port=a.port,access_log=False,log_level="warning")
if __name__=="__main__":main()
