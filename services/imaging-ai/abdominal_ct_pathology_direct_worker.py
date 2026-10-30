#!/usr/bin/env python3
"""One authorized original-HU CT -> two DISTINCT pretrained abdominal pathology tasks.

Uses existing genuine TotalSegmentator 2.18.0 abdominal_ct_pathology_inference.py
and original installed checkpoints. Same native source, sequential CPU runs,
per-task honest unavailable/failed/completed states; never a mock or diagnosis.
No filesystem path or image bytes leave the local Linux research host.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
import platform
import secrets
import signal
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from abdominal_ct_pathology_inference import TASKS, MIN_RAM, VERSION, AUTH, digest
from totalsegmentator_input import inspect_input
from pancreatic_tumor_original_inference import TASK as PANCREAS_TASK, MIN_RAM as PANCREAS_MIN_RAM, SCHEMA as PANCREAS_SCHEMA

ALL_TASKS=(*TASKS,PANCREAS_TASK)
CALCULUS_TASK='renal_calculus_candidates'

MAX_BYTES=352+512*512*300*4
MAX_REPORT=512*1024


def installed(checkpoints, *, allow_calculus_only=False):
    """Operator-supplied exact files; file SHA is NOT vendor loader proof."""
    if platform.system()!="Linux":
        raise ValueError("isolated_pinned_original_model_runtime_required")
    if any(task in checkpoints for task in TASKS):
        if importlib.metadata.version("TotalSegmentator")!=VERSION:
            raise ValueError("isolated_pinned_original_model_runtime_required")
    if PANCREAS_TASK in checkpoints:
        if importlib.metadata.version("monai") not in ("1.5.1","1.5.0"):
            raise ValueError("original_monai_pancreatic_runtime_required")
    result={}
    for task in ALL_TASKS:
        pair=checkpoints.get(task)
        if pair is None:
            continue
        if not isinstance(pair,tuple) or len(pair)!=2:
            raise ValueError("bad_model_file_spec")
        path,sha=pair
        file=Path(path)
        if (file.is_symlink() or not file.is_file() or
            not (1024**2 if task==PANCREAS_TASK else 1024)<file.stat().st_size<1024**3 or
            file.suffix not in ((".ts",) if task==PANCREAS_TASK else (".pt",".pth")) or
            not isinstance(sha,str) or len(sha)!=64 or
            any(x not in "0123456789abcdef" for x in sha) or
            digest(file)!=sha):
            raise ValueError("original_"+task+"_checkpoint_mismatch")
        result[task]=(file,sha)
    if not result and not allow_calculus_only:
        raise ValueError("no_original_pretrained_pathology_model_installed")
    return result


def create_app(*,token,origin,checkpoints,port=8775,calculus_source=None):
    if not isinstance(token,str) or not 32<=len(token)<=128:
        raise ValueError("worker_session_token_required")
    if not isinstance(origin,str) or not (
        origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:")):
        raise ValueError("local_origin_required")
    if not 1024<=port<=65535:raise ValueError("loopback_port_required")
    models=installed(checkpoints,allow_calculus_only=calculus_source is not None)
    if calculus_source is not None and importlib.metadata.version('TotalSegmentator')!=VERSION:
        raise ValueError('original_anatomy_runtime_version_required')
    if calculus_source is not None and (not isinstance(calculus_source,tuple) or len(calculus_source)!=2 or
        calculus_source[0] not in ("CC0","CC BY 3.0","CC BY 4.0") or
        not isinstance(calculus_source[1],str) or not calculus_source[1].startswith("https://")):
        raise ValueError("renal_calculus_public_source_provenance_required")
    lock=asyncio.Lock()
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)

    @app.middleware("http")
    async def auth(request:Request,next_handler):
        headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if request.headers.get("origin")!=origin or request.headers.get("host")!=f"127.0.0.1:{port}":
            return JSONResponse({"detail":"local_browser_origin_or_host_denied"},status_code=403,headers=headers)
        headers.update({"Access-Control-Allow-Origin":origin,"Vary":"Origin"})
        if request.method=="OPTIONS":
            requested={x.strip().lower() for x in request.headers.get(
                "access-control-request-headers","").split(",") if x.strip()}
            if (request.headers.get("access-control-request-method") not in ("GET","POST") or
                not requested.issubset({"authorization","content-type","x-opus-source-sha256",
                                        "x-opus-public-research-authorization"})):
                return Response(status_code=403,headers=headers)
            headers.update({"Access-Control-Allow-Methods":"GET,POST",
                "Access-Control-Allow-Headers":"Authorization,Content-Type,X-Opus-Source-Sha256,X-Opus-Public-Research-Authorization",
                "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=headers)
        if not secrets.compare_digest(request.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401,headers=headers)
        out=await next_handler(request);out.headers.update(headers);return out

    @app.get("/v1/abdomen/capabilities")
    async def capabilities():
        import psutil
        return {"schema":"opus-original-abdominal-pathology-worker/v1",
            "model":"TotalSegmentator","packageVersion":VERSION,
            "ready":psutil.virtual_memory().available>=MIN_RAM,
            "installedTasks":{t:{"checkpointSha256":sha,"observedFileVerified":digest(path)==sha}
                              for t,(path,sha) in models.items()},
            "renalCalculusConfigured":calculus_source is not None,
            "mode":"local-linux-cpu-research","sourceFormat":"original-HU-NIfTI",
            "patientMode":False,"dataPolicy":"public-nonpatient-research-only",
            "vendorCheckpointUseCryptographicallyProven":False}

    @app.post("/v1/abdomen/analyze")
    async def analyze(request:Request):
        if lock.locked():raise HTTPException(409,"abdominal_worker_busy")
        if (request.headers.get("content-type")!="application/octet-stream" or
            request.headers.get("x-opus-public-research-authorization")!="approved-nonpatient-source"):
            raise HTTPException(403,"public_source_authorization_required")
        sha=request.headers.get("x-opus-source-sha256","")
        if len(sha)!=64 or any(ch not in "0123456789abcdef" for ch in sha):
            raise HTTPException(422,"original_source_sha_required")
        if int(request.headers.get("content-length","0") or "0")>MAX_BYTES:
            raise HTTPException(413,"original_CT_too_large")
        async with lock:
            import psutil
            if psutil.virtual_memory().available<MIN_RAM:
                raise HTTPException(507,"at_least_10GiB_free_RAM_required")
            with tempfile.TemporaryDirectory(prefix="opus-original-abdomen-") as tmp:
                root=Path(tmp);src=root/"source.nii";h=hashlib.sha256();n=0
                with src.open("xb") as f:
                    async for chunk in request.stream():
                        n+=len(chunk)
                        if n>MAX_BYTES:raise HTTPException(413,"original_CT_too_large")
                        h.update(chunk);f.write(chunk)
                if n<353 or n!=src.stat().st_size or h.hexdigest()!=sha:
                    raise HTTPException(422,"original_CT_source_digest_mismatch")
                try:
                    if inspect_input(src)["dimensions"][2]<8:
                        raise ValueError("short_scan")
                except ValueError:
                    raise HTTPException(422,"invalid_original_CT_geometry") from None
                outputs={}
                for task in (*ALL_TASKS,CALCULUS_TASK):
                    if task==CALCULUS_TASK:
                        if calculus_source is None or request.headers.get("x-opus-ncct-verified")!="native-noncontrast-verified":
                            outputs[task]={"status":"unavailable","reason":"original_anatomy_or_noncontrast_unverified"}
                            continue
                        if psutil.virtual_memory().available<MIN_RAM:
                            outputs[task]={"status":"unavailable","reason":"memory_preflight_failed"}
                            continue
                        report=root/"renal-calculus-report.json"
                        cmd=[sys.executable,str(Path(__file__).with_name("renal_calculus_native_executor.py")),
                            "--ct",str(src),"--output",str(report),
                            "--source-license",calculus_source[0],"--source-url",calculus_source[1],
                            "--licensed-deidentified-public-NCCT-confirmed"]
                        env={k:v for k,v in os.environ.items() if k in
                             ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH","TOTALSEG_HOME_DIR",
                              "XDG_CACHE_HOME","MPLCONFIGDIR","TORCH_HOME","OMP_NUM_THREADS","MKL_NUM_THREADS")}
                        env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1"})
                        process=await asyncio.create_subprocess_exec(*cmd,
                            stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL,
                            start_new_session=True,env=env)
                        try:
                            await asyncio.wait_for(process.wait(),timeout=2400)
                            if process.returncode or not report.is_file() or report.stat().st_size>MAX_REPORT:
                                outputs[task]={"status":"failed","reason":"original_anatomy_or_HU_forward_failed"}
                            else:
                                data=json.loads(report.read_text())
                                if (data.get("schema")!="opus-kidney-calculus-ncct-candidates/v1" or
                                    data.get("sourceCTSHA256")!=sha or
                                    data.get("trainedAnatomyModelExecutedByThisAdapter") is not True or
                                    data.get("absenceOfStonesEstablished") is not False or
                                    data.get("ureterEvaluated") is not False):
                                    outputs[task]={"status":"failed","reason":"renal_evidence_source_mismatch"}
                                else:outputs[task]={"status":"completed","report":data}
                        except Exception:
                            outputs[task]={"status":"failed","reason":"renal_calculus_not_assessed"}
                        finally:
                            if process.returncode is None:
                                try:os.killpg(process.pid,signal.SIGKILL)
                                except ProcessLookupError:pass
                                await process.wait()
                        continue
                    if task not in models:
                        outputs[task]={"status":"unavailable","reason":"checkpoint_not_installed"}
                        continue
                    model,observed=models[task]
                    if digest(model)!=observed:
                        outputs[task]={"status":"unavailable","reason":"checkpoint_modified"}
                        continue
                    if psutil.virtual_memory().available<(PANCREAS_MIN_RAM if task==PANCREAS_TASK else MIN_RAM):
                        outputs[task]={"status":"unavailable","reason":"memory_preflight_failed"}
                        continue
                    admission=root/(task+"-admission.json")
                    admission.write_text(json.dumps({
                        "schema":"opus-abdominal-ct-pathology-admission/v1",
                        "task":task,"sourceNiftiSha256":sha,
                        "sourcePublicAndRightsCleared":True,
                        "imageLicenseReviewed":True,"researchOnly":True,
                        "originalHuVolumeVerified":True,
                        "notPatientData":True,"modelLicenseReviewed":True,
                    }))
                    mask=root/(task+"-mask.nii.gz")
                    report=root/(task+"-report.json")
                    if task==PANCREAS_TASK:
                        cmd=[sys.executable,str(Path(__file__).with_name("pancreatic_tumor_original_inference.py")),
                            "--source",str(src),"--output-json",str(report),
                            "--checkpoint",str(model),"--checkpoint-sha256",observed,
                            "--source-admission",str(admission),"--authorization",AUTH]
                    else:
                        cmd=[sys.executable,str(Path(__file__).with_name("abdominal_ct_pathology_inference.py")),
                            "--task",task,"--source",str(src),
                            "--output-mask",str(mask),"--output-json",str(report),
                            "--checkpoint",str(model),"--checkpoint-sha256",observed,
                            "--source-admission",str(admission),"--authorization",AUTH]
                    env={k:v for k,v in os.environ.items() if k in
                         ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH",
                          "TOTALSEG_HOME_DIR","OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS")}
                    env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1",
                                "HF_HUB_DISABLE_TELEMETRY":"1"})
                    process=await asyncio.create_subprocess_exec(*cmd,
                        stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL,
                        start_new_session=True,env=env)
                    try:
                        for _ in range(2400):
                            if await request.is_disconnected():
                                raise HTTPException(499,"client_disconnected")
                            try:
                                await asyncio.wait_for(process.wait(),timeout=1)
                                break
                            except asyncio.TimeoutError:
                                continue
                        else:
                            outputs[task]={"status":"failed","reason":"original_model_timeout"}
                            continue
                        if (process.returncode!=0 or not report.is_file()
                            or report.stat().st_size>MAX_REPORT or
                            (task!=PANCREAS_TASK and not mask.is_file())):
                            outputs[task]={"status":"failed","reason":"original_model_forward_failed"}
                            continue
                        data=json.loads(report.read_text(encoding="utf-8"))
                        if task==PANCREAS_TASK:
                            verified=(data.get("schema")==PANCREAS_SCHEMA and
                                data.get("task")==task and data.get("sourceNiftiSha256")==sha and
                                data.get("modelCheckpointFileSha256")==observed and
                                data.get("actualPretrainedModelForwardCompleted") is True and
                                data.get("clinicalValidation") is False and
                                data.get("negativeCancerDiagnosisPermitted") is False)
                        else:
                            verified=(data.get("schema")=="opus-real-abdominal-ct-pathology-proposals/v1" and
                                data.get("task")==task and data.get("sourceNiftiSha256")==sha and
                                data.get("observedCheckpointFileSha256")==observed and
                                data.get("outputNativeMaskSha256")==digest(mask) and
                                data.get("execution",{}).get("actualPretrainedInferenceClaimed") is True and
                                data.get("execution",{}).get("mode")=="isolated-original-model" and
                                data.get("negativeDiagnosisPermitted") is False)
                        if not verified:
                            outputs[task]={"status":"failed","reason":"source_or_model_proof_mismatch"}
                            continue
                        outputs[task]={"status":"completed","report":data}
                    except HTTPException:
                        raise
                    except Exception:
                        outputs[task]={"status":"failed","reason":"model_or_evidence_unverified"}
                    finally:
                        if process.returncode is None:
                            try:os.killpg(process.pid,signal.SIGKILL)
                            except ProcessLookupError:pass
                            await process.wait()
                return {"schema":"opus-original-abdominal-ct-pathology-batch/v1",
                    "sourceNiftiSha256":sha,"tasks":outputs,
                    "clinicalValidation":False,"noNegativeDiagnosis":True}
    return app


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--origin",default="http://127.0.0.1:3000")
    p.add_argument("--port",type=int,default=8775)
    p.add_argument("--kidney-checkpoint")
    p.add_argument("--kidney-sha")
    p.add_argument("--liver-checkpoint")
    p.add_argument("--liver-sha")
    p.add_argument("--pancreas-checkpoint")
    p.add_argument("--pancreas-sha")
    p.add_argument("--renal-calculus-public-license")
    p.add_argument("--renal-calculus-public-url")
    a=p.parse_args()
    specs={}
    if a.kidney_checkpoint and a.kidney_sha:
        specs["kidney_cysts"]=(a.kidney_checkpoint,a.kidney_sha)
    if a.liver_checkpoint and a.liver_sha:
        specs["liver_lesions"]=(a.liver_checkpoint,a.liver_sha)
    if a.pancreas_checkpoint and a.pancreas_sha:
        specs[PANCREAS_TASK]=(a.pancreas_checkpoint,a.pancreas_sha)
    token=secrets.token_urlsafe(36).replace("-","_")
    calculus=(a.renal_calculus_public_license,a.renal_calculus_public_url) if (a.renal_calculus_public_license and a.renal_calculus_public_url) else None
    app=create_app(token=token,origin=a.origin,checkpoints=specs,port=a.port,calculus_source=calculus)
    print("Abdominal original research worker token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=a.port,access_log=False)


if __name__=="__main__":
    main()
