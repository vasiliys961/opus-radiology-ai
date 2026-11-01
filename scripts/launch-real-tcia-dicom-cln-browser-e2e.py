#!/usr/bin/env python3
"""Run genuine original TCIA scanner DICOM through the ACTUAL browser UI.

The browser uploads the full original source, starts the real installed CLN
pretrained worker, and explicitly approves two genuine Gemini/Opus calls.
No synthetic detector, dummy LLM response, or reused CLN inference.
"""
from __future__ import annotations
import argparse,hashlib,importlib.util,json,os
from pathlib import Path
import secrets,subprocess,sys,time,requests
ROOT=Path(__file__).resolve().parents[1]
SHA_CHAIN="bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61"
CHECKPOINT="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
def load(path):
    spec=importlib.util.spec_from_file_location("opus_public_loader_"+path.stem.replace("-","_"),path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod
def run(public,work,report):
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise ValueError("actual_model_provider_not_configured")
    if work.exists() or report.exists():
        raise ValueError("new_private_work_directory_and_report_required")
    manifest=json.loads((public/"reference.json").read_text())
    if (manifest.get("schema")!="opus-r231-browser-reference/v1" or
        manifest.get("sourceContentChainSha256")!=SHA_CHAIN or
        manifest.get("allSourceFrames") is not True or
        manifest.get("selectedFrames")!=103 or manifest.get("license")!="CC BY 3.0"):
        raise ValueError("original_public_TCIA_reference_chain_not_pinned")
    files=sorted((public/"dicom").glob("reference-*.dcm"))
    if len(files)!=103 or len(manifest["selectedFileSha256"])!=103:
        raise ValueError("original_public_TCIA_DICOM_files_missing")
    h=hashlib.sha256()
    for i,path in enumerate(files):
        if path.name!=f"reference-{i:03}.dcm" or path.is_symlink():
            raise ValueError("wrong_original_slice")
        digest=hashlib.sha256(path.read_bytes()).digest()
        if digest.hex()!=manifest["selectedFileSha256"][i]:
            raise ValueError("TCIA_original_DICOM_SOP_bytes_changed")
        h.update(digest)
    if h.hexdigest()!=SHA_CHAIN:raise ValueError("TCIA_original_DICOM_chain_changed")
    work.mkdir(parents=True,exist_ok=False)
    model=load(ROOT/"scripts/cln-msd-original-positive-public-ct.py").load_cln()
    model_root=work/"models"
    original=model.provision(model_root/model.TASK/model.TRAINER)
    if (original.get("checkpointSHA256")!=CHECKPOINT or
        original.get("publisherLfsWeightSHA256Verified") is not True):
        raise ValueError("original_CLN_checkpoint_sha_failed")
    token=secrets.token_urlsafe(48)
    operator=secrets.token_urlsafe(48)
    env=os.environ.copy()
    env.update({
        "OPUS_CLN_MODEL_ROOT":str(model_root),
        "OPUS_CLN_CHECKPOINT_SHA256":CHECKPOINT,
        "OPUS_CLN_WORKER_TOKEN":token,
        "OPUS_CLN_WORKER_ORIGIN":"http://127.0.0.1:3000",
        "nnUNet_results":str(model_root),
        "nnUNet_raw":str(work/"nnunet-raw"),
        "nnUNet_preprocessed":str(work/"nnunet-preprocessed"),
        "OMP_NUM_THREADS":"2","MKL_NUM_THREADS":"2","OPENBLAS_NUM_THREADS":"1",
        "RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT":"1",
        "RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED":"1",
        "RADIOLOGY_LOCAL_RESEARCH_OPERATOR_TOKEN":operator,
        "CUDA_VISIBLE_DEVICES":"-1",
    })
    worker=None;server=None
    try:
        worker_log=(work/"cln-worker.log").open("wb")
        worker=subprocess.Popen([sys.executable,str(ROOT/"services/imaging-ai/cln_native_upload_worker.py")],
           cwd=str(ROOT),stdout=worker_log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
        session=requests.Session()
        deadline=time.monotonic()+80
        while time.monotonic()<deadline:
            if worker.poll() is not None:raise RuntimeError("CLN worker exited during startup")
            try:
                r=session.get("http://127.0.0.1:8783/v1/cln/capabilities",timeout=3,
                              headers={"Origin":"http://127.0.0.1:3000","Authorization":"Bearer "+token})
                if r.ok and r.json().get("originalWeightsVerified") is True:break
            except requests.RequestException:pass
            time.sleep(1)
        else:raise TimeoutError("authentic_CLN_worker_not_ready")
        server_log=(work/"next-dev.log").open("wb")
        server=subprocess.Popen(["npm","run","dev","--","--hostname","127.0.0.1","--port","3000"],
           cwd=str(ROOT/"web"),stdout=server_log,stderr=subprocess.STDOUT,env=env,start_new_session=True)
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            if server.poll() is not None:raise RuntimeError("Next dev exited before browser")
            try:
                r=session.get("http://127.0.0.1:3000/viewer",timeout=3)
                if r.ok:break
            except requests.RequestException:pass
            time.sleep(1)
        else:raise TimeoutError("actual_Opus_DICOM_viewer_unavailable")
        browser=subprocess.run(["node","scripts/check-real-tcia-dicom-cln-browser-e2e.mjs",
                str(public),str(report),operator],cwd=str(ROOT),env=env,timeout=3900,check=True)
        if browser.returncode!=0 or not report.is_file():
            raise RuntimeError("browser_original_DICOM_to_radiology_report_unverified")
        print("ACTUAL ORIGINAL DICOM -> BROWSER -> REAL CLN -> GEMINI -> OPUS",
            json.dumps({"all103OriginalSOPFiles":True,"realModelForwardViaApp":True,
                        "independentGemini":True,"actualOpusReport":True}),flush=True)
    finally:
        for process in (server,worker):
            if process is not None:
                process.terminate()
                try:process.wait(timeout=10)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)
        if "worker_log" in locals():worker_log.close()
        if "server_log" in locals():server_log.close()
if __name__=="__main__":
    parser=argparse.ArgumentParser()
    for name in ("reference","work","report"):
        parser.add_argument("--"+name,required=True,type=Path)
    args=parser.parse_args()
    run(args.reference,args.work,args.report)
