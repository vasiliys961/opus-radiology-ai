#!/usr/bin/env python3
"""Start real original CLN CPU and the Opus DICOM viewer on a Linux research host.

No fake inference, no patient-cloud mode, no automatic external upload.
All prerequisites must be installed before launching this command.
"""
from __future__ import annotations
import argparse, importlib.util, json, os, secrets, shutil, signal, subprocess, sys, time
from pathlib import Path
from urllib.error import URLError, HTTPError
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
CHECKPOINT="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
MODEL_SCRIPT=ROOT/"scripts/cln-msd-original-ct-cpu.py"

def free_ram_linux():
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1])*1024
    except (OSError, ValueError, IndexError):
        pass
    return 0

def preflight(cache:Path,cloud:bool):
    errors=[]
    if sys.platform!="linux":errors.append("Original CLN research CPU worker requires Linux")
    if free_ram_linux()<12*1024**3:errors.append("At least 12 GiB available RAM required")
    parent=next((p for p in (cache,*cache.parents) if p.exists()),Path("/"))
    if shutil.disk_usage(parent).free<6*1024**3:errors.append("At least 6 GiB free disk space required")
    if not shutil.which("nnUNetv2_predict"):errors.append("Install nnUNetv2 and original CPU dependencies")
    if not shutil.which("npm"):errors.append("Install Node.js/npm")
    if not (ROOT/"web/node_modules").is_dir():errors.append("Run cd web && npm ci")
    for name in ("torch","nnunetv2","fastapi","uvicorn","psutil","huggingface_hub"):
        if importlib.util.find_spec(name) is None:errors.append("Missing Python package: "+name)
    if not MODEL_SCRIPT.is_file():errors.append("Original CLN provisioning code unavailable")
    if cloud and len(os.environ.get("OPENROUTER_API_KEY",""))<16:
        errors.append("Set OPENROUTER_API_KEY to use genuine Gemini and Opus")
    return errors

def provision(cache:Path):
    spec=importlib.util.spec_from_file_location("opus_original_cln",MODEL_SCRIPT)
    if not spec or not spec.loader:raise RuntimeError("Original CLN loader unavailable")
    model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
    receipt=model.provision(cache/model.TASK/model.TRAINER)
    if receipt.get("checkpointSHA256")!=CHECKPOINT or receipt.get("publisherLfsWeightSHA256Verified") is not True:
        raise RuntimeError("Original publisher CLN checkpoint SHA-256 mismatch")

def ready(url:str,process:subprocess.Popen,*,headers=None,require_model=False,seconds=120):
    end=time.monotonic()+seconds
    while time.monotonic()<end:
        if process.poll() is not None:raise RuntimeError("Worker or viewer stopped during startup")
        try:
            with urlopen(Request(url,headers=headers or {}),timeout=3) as response:
                if response.status==200:
                    if require_model:
                        result=json.loads(response.read(16_384))
                        if result.get("originalWeightsVerified") is not True:
                            raise RuntimeError("Original CLN worker rejected verified checkpoint")
                    return
        except (URLError,HTTPError,TimeoutError,ConnectionError):
            pass
        time.sleep(1)
    raise RuntimeError("Viewer/worker startup timed out")

def terminate(process):
    if process is None or process.poll() is not None:return
    try:os.killpg(process.pid,signal.SIGTERM)
    except ProcessLookupError:return
    try:process.wait(timeout=12)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid,signal.SIGKILL);process.wait()

def main():
    parser=argparse.ArgumentParser(description="Launch actual Opus DICOM + CLN nnU-Net on Linux")
    parser.add_argument("--model-cache",type=Path,default=Path.home()/".cache/opus-radiology-ai/original-cln")
    parser.add_argument("--enable-public-cloud",action="store_true",
                        help="Explicitly enable approved public research Gemini + Opus; never patient production")
    parser.add_argument("--check-only",action="store_true",
                        help="Only test prerequisites; no weights downloaded or services started")
    args=parser.parse_args()
    cache=args.model_cache.expanduser().resolve()
    problems=preflight(cache,args.enable_public_cloud)
    if problems:
        for issue in problems:print("BLOCKED: "+issue,file=sys.stderr)
        return 2
    if args.check_only:
        print("Preflight passed. This does not demonstrate model inference.")
        return 0
    print("Verifying genuine original CLN weights and SHA-256...",flush=True)
    provision(cache)
    worker_secret=secrets.token_urlsafe(48)
    operator_secret=secrets.token_urlsafe(48)
    env=os.environ.copy()
    env.update({
        "OPUS_CLN_MODEL_ROOT":str(cache),"OPUS_CLN_CHECKPOINT_SHA256":CHECKPOINT,
        "OPUS_CLN_WORKER_TOKEN":worker_secret,"OPUS_CLN_WORKER_ORIGIN":"http://127.0.0.1:3000",
        "nnUNet_results":str(cache),"nnUNet_raw":str(cache/"nnunet-raw"),
        "nnUNet_preprocessed":str(cache/"nnunet-preprocessed"),
        "RADIOLOGY_PUBLIC_ORIGINAL_DICOM_EXTENDED_REVIEW":"1",
        "RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN":operator_secret,
        "RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT":"1" if args.enable_public_cloud else "0",
        "RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED":"1" if args.enable_public_cloud else "0",
        "OMP_NUM_THREADS":"2","MKL_NUM_THREADS":"2","OPENBLAS_NUM_THREADS":"1",
        "CUDA_VISIBLE_DEVICES":"-1",
    })
    # systemd and CI stop signals must also terminate both child processes.
    def on_terminate(_signum,_frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,on_terminate)
    worker=viewer=None
    try:
        worker=subprocess.Popen([sys.executable,str(ROOT/"services/imaging-ai/cln_native_upload_worker.py")],
                                cwd=ROOT,env=env,start_new_session=True)
        ready("http://127.0.0.1:8783/v1/cln/capabilities",worker,require_model=True,headers={
            "Origin":"http://127.0.0.1:3000","Authorization":"Bearer "+worker_secret})
        viewer=subprocess.Popen(["npm","run","dev","--","--hostname","127.0.0.1","--port","3000"],
                                cwd=ROOT/"web",env=env,start_new_session=True)
        ready("http://127.0.0.1:3000/viewer",viewer)
        print("LOCAL DICOM VIEWER: http://127.0.0.1:3000/viewer",flush=True)
        if args.enable_public_cloud:
            print("ONE-SESSION OPERATOR TOKEN (enter only in local browser): "+operator_secret,flush=True)
            print("Review outgoing PNGs and approve the two paid requests explicitly.",flush=True)
        else:print("Gemini and Opus disabled; CLN local-only mode",flush=True)
        print("Ctrl+C stops the viewer and the private CLN worker",flush=True)
        while worker.poll() is None and viewer.poll() is None:time.sleep(1)
        raise RuntimeError("Viewer or original CLN worker unexpectedly exited")
    except KeyboardInterrupt:
        return 0
    finally:
        terminate(viewer);terminate(worker)

if __name__=="__main__":
    try:raise SystemExit(main())
    except (RuntimeError,OSError) as exc:
        print("ERROR: "+str(exc),file=sys.stderr)
        raise SystemExit(1)
