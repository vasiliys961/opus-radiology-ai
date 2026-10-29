#!/usr/bin/env python3
"""Private real pretrained PE research worker (original Mazurowski nnU-Net).

Exact vendor code revision, original 566 MB author checkpoint SHA, genuine
native HU CTPA. Patient data and cloud egress FORBIDDEN; original vendor model
weights CC BY-NC 4.0. A candidate cannot diagnose/exclude PE.
"""
from __future__ import annotations
import argparse, asyncio, hashlib, json, math, os, platform, secrets, signal
import subprocess, sys, tempfile
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse, Response

VENDOR_REV="b4c50008bbbf825282ccf10767f819276e320fb9"
SOURCE_MODEL_REF="7ce235f"
SCHEMA="opus-original-mazurowski-ctpa-pe-source/v1"
CAPABILITY="opus-original-pe-ctpa-worker/v1"
MAX_BYTES=352+512*512*300*4
MIN_RAM=12*1024**3

def sha(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def models_verified(model_dir,vendor_repo,expected_sha):
    if platform.system()!="Linux":
        raise ValueError("isolated_linux_CPU_research_host_required")
    md=Path(model_dir);vr=Path(vendor_repo)
    model=md/"pytorch_model.bin";config=md/"config.json";runner=vr/"scripts/run_inference.py"
    if (md.is_symlink() or vr.is_symlink() or not md.is_dir() or not vr.is_dir() or
        model.is_symlink() or config.is_symlink() or runner.is_symlink() or
        not model.is_file() or not config.is_file() or not runner.is_file() or
        not 300*1024**2<model.stat().st_size<900*1024**2 or
        not isinstance(expected_sha,str) or len(expected_sha)!=64 or
        any(ch not in "0123456789abcdef" for ch in expected_sha) or
        sha(model)!=expected_sha):
        raise ValueError("author_original_PE_model_unverified")
    cmd=subprocess.run(["git","-C",str(vr),"rev-parse","HEAD"],
                       stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                       encoding="utf-8",timeout=5,check=True)
    if cmd.stdout.strip()!=VENDOR_REV:
        raise ValueError("PE_publisher_code_revision_changed")
    return md,vr

def native_positive_candidates(seg,affine):
    import numpy as np
    from scipy import ndimage
    if seg.ndim!=3 or seg.size>512*512*300 or not np.isin(seg,[0,1]).all():
        raise ValueError("invalid_native_3D_model_PE_mask")
    labels,count=ndimage.label(seg==1,structure=ndimage.generate_binary_structure(3,2))
    if count>100000:raise ValueError("excessive_model_mask_components")
    voxel_ml=abs(float(np.linalg.det(affine[:3,:3])))/1000
    result=[]
    for index,box in enumerate(ndimage.find_objects(labels),1):
        if box is None:continue
        obj=labels[box]==index
        n=int(np.count_nonzero(obj))
        if n<3:continue
        ijk=np.array(ndimage.center_of_mass(obj))+[s.start for s in box]
        ras=(affine@np.r_[ijk,1])[:3]
        result.append({
            "nativeVoxelBoundsIJK":[[int(s.start),int(s.stop)-1] for s in box],
            "sourceCentroidIJK":[round(float(v),3) for v in ijk],
            "sourceRASmm":[round(float(v),3) for v in ras],
            "modelCandidateVoxels":n,
            "modelCandidateMl":round(n*voxel_ml,6),
            "confirmedEmbolism":False,
        })
        if len(result)>512:raise ValueError("too_many_model_candidates_to_review")
    result.sort(key=lambda x:x["modelCandidateVoxels"],reverse=True)
    return result

def create_app(*,token,origin,model_dir,vendor_repo,model_sha256,port=8776):
    if not isinstance(token,str) or not 32<=len(token)<=128:
        raise ValueError("temporary_worker_session_token_required")
    if not isinstance(origin,str) or not (origin.startswith("http://127.0.0.1:")
        or origin.startswith("http://localhost:")):
        raise ValueError("loopback_browser_origin_required")
    if not 1024<=port<=65535:raise ValueError("loopback_port_required")
    model_dir,vendor_repo=models_verified(model_dir,vendor_repo,model_sha256)
    lock=asyncio.Lock()
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    @app.middleware("http")
    async def auth(req:Request,handler):
        h={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if req.headers.get("origin")!=origin or req.headers.get("host")!=f"127.0.0.1:{port}":
            return JSONResponse({"detail":"browser_origin_or_host_denied"},status_code=403,headers=h)
        h.update({"Access-Control-Allow-Origin":origin,"Vary":"Origin"})
        if req.method=="OPTIONS":
            asked={x.strip().lower() for x in req.headers.get(
                "access-control-request-headers","").split(",") if x.strip()}
            if (req.headers.get("access-control-request-method") not in ("GET","POST")
                or not asked.issubset({"authorization","content-type","x-opus-source-sha256",
                                       "x-opus-ctpa-protocol-confirmed"})):
                return Response(status_code=403,headers=h)
            h.update({"Access-Control-Allow-Headers":
                "Authorization,Content-Type,X-Opus-Source-Sha256,X-Opus-CTPA-Protocol-Confirmed",
                "Access-Control-Allow-Methods":"GET,POST",
                "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=h)
        if not secrets.compare_digest(req.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401,headers=h)
        out=await handler(req);out.headers.update(h);return out

    @app.get("/v1/pe/capabilities")
    async def capabilities():
        import psutil
        return {"schema":CAPABILITY,"model":"Mazurowski PE nnUNet ResidualEncoderUNet",
                "publisherCodeRevision":VENDOR_REV,"modelReleaseReference":SOURCE_MODEL_REF,
                "weightFileSha256":model_sha256,"originalWeightFileObserved":sha(model_dir/"pytorch_model.bin")==model_sha256,
                "ready":psutil.virtual_memory().available>=MIN_RAM,
                "patientMode":False,"protocol":"CTPA-only",
                "mode":"isolated-linux-cpu-research",
                "dataPolicy":"approved-public-nonpatient-only",
                "vendorActiveParametersCryptographicallyProven":False}

    @app.post("/v1/pe/analyze")
    async def analyze(req:Request):
        if lock.locked():raise HTTPException(409,"original_PE_worker_busy")
        if req.headers.get("x-opus-ctpa-protocol-confirmed")!="yes":
            raise HTTPException(403,"physician_must_confirm_real_CTPA_protocol")
        if req.headers.get("content-type")!="application/octet-stream":
            raise HTTPException(415,"original_HU_NIfTI_required")
        digest=req.headers.get("x-opus-source-sha256","")
        if len(digest)!=64 or any(c not in "0123456789abcdef" for c in digest):
            raise HTTPException(422,"source_SHA256_missing")
        if int(req.headers.get("content-length","0") or "0")>MAX_BYTES:
            raise HTTPException(413,"CTPA_too_large")
        async with lock:
            import nibabel as nib
            import numpy as np
            import psutil
            if psutil.virtual_memory().available<MIN_RAM:
                raise HTTPException(507,"PE_model_requires_12GiB_available_RAM")
            if sha(model_dir/"pytorch_model.bin")!=model_sha256:
                raise HTTPException(503,"original_model_file_changed")
            with tempfile.TemporaryDirectory(prefix="opus-original-pe-") as temp:
                root=Path(temp);source=root/"original-ctpa.nii";mask=root/"actual-vendor-mask.npz"
                h=hashlib.sha256();size=0
                with source.open("xb") as f:
                    async for chunk in req.stream():
                        size+=len(chunk)
                        if size>MAX_BYTES:raise HTTPException(413,"source_too_large")
                        h.update(chunk);f.write(chunk)
                if size<353 or size!=source.stat().st_size or h.hexdigest()!=digest:
                    raise HTTPException(422,"original_CTPA_source_changed")
                image=nib.load(str(source))
                if (image.ndim!=3 or math.prod(image.shape)>512*512*300
                    or image.header.get_xyzt_units()[0]!="mm" or
                    not np.isfinite(image.affine).all() or
                    abs(float(np.linalg.det(image.affine[:3,:3])))<1e-6):
                    raise HTTPException(422,"CTPA_native_geometry_unverified")
                cmd=[sys.executable,str(vendor_repo/"scripts/run_inference.py"),
                     "--model-dir",str(model_dir),"--input",str(source),
                     "--output",str(mask),"--device","cpu","--no-amp",
                     "--tile-size","64,128,128","--min-tile-size","64,128,128",
                     "--overlap","0.1"]
                env={k:v for k,v in os.environ.items() if k in
                    ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH",
                     "OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS")}
                env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1",
                            "HF_HUB_DISABLE_TELEMETRY":"1"})
                proc=await asyncio.create_subprocess_exec(*cmd,env=env,
                    stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL,
                    start_new_session=True)
                try:
                    for _ in range(2350):
                        if await req.is_disconnected():
                            raise HTTPException(499,"CTPA_browser_disconnected")
                        try:
                            await asyncio.wait_for(proc.wait(),timeout=1)
                            break
                        except asyncio.TimeoutError:
                            pass
                    else:raise HTTPException(504,"original_PE_model_timeout")
                    if proc.returncode!=0 or not mask.is_file() or mask.stat().st_size>256*1024**2:
                        raise HTTPException(422,"PE_pretrained_model_execution_failed")
                    with np.load(str(mask),allow_pickle=False) as data:
                        if data.files!=["segmentation"]:
                            raise HTTPException(422,"unexpected_original_PE_model_output")
                        array=np.asarray(data["segmentation"])
                    # Official vendor source inference emits ZYX, matching
                    # research reference scripts/real-public-fumpe-pulmonary-embolism.py.
                    native=np.moveaxis(array,(0,1,2),(2,1,0))
                    if native.shape!=image.shape or not np.isin(native,[0,1]).all():
                        raise HTTPException(422,"model_mask_not_registered_to_exact_native_CT")
                    lesions=native_positive_candidates(native,image.affine)
                    return {"schema":SCHEMA,
                        "model":"Mazurowski PE nnUNet ResidualEncoderUNet",
                        "task":"pulmonary_embolism_ctpa",
                        "originalPublishedWeightsRevision":SOURCE_MODEL_REF,
                        "originalVendorCodeRevision":VENDOR_REV,
                        "observedModelWeightFileSHA256":model_sha256,
                        "sourceNiftiSHA256":digest,
                        "trainedModelMaskSHA256":sha(mask),
                        "sourceNativeShapeXYZ":list(image.shape),
                        "sourceNativeVoxelPositiveCount":int(np.count_nonzero(native)),
                        "sourceSpatialUnits":"mm",
                        "realOriginalPretrainedForwardCompleted":True,
                        "lesions":lesions,
                        "protocolConfirmedByOperatorNotDICOM":True,
                        "clinicalValidation":False,
                        "negativeDiagnosisPermitted":False,
                        "independentHoldout":False,
                        "sourceSOPRegistrationVerified":False,
                        "limitations":[
                          "Vendor public model research-only CC BY-NC 4.0; no clinical patient release.",
                          "One public prior FUMPE case Dice 0.038119; extremely low sensitivity potential.",
                          "Explicit physician CTPA protocol attestation is not machine verification.",
                          "No independent accuracy validation or negative PE exclusion.",
                          "Vendor output native alignment checked, but exact DICOM SOP mapping not proven.",
                        ]}
                finally:
                    if proc.returncode is None:
                        try:os.killpg(proc.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        await proc.wait()
    return app

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir",required=True)
    parser.add_argument("--vendor-code",required=True)
    parser.add_argument("--weights-sha",required=True)
    parser.add_argument("--origin",default="http://127.0.0.1:3000")
    parser.add_argument("--port",type=int,default=8776)
    args=parser.parse_args()
    token=secrets.token_urlsafe(36).replace("-","_")
    app=create_app(token=token,origin=args.origin,model_dir=args.model_dir,
                   vendor_repo=args.vendor_code,model_sha256=args.weights_sha,
                   port=args.port)
    print("Original PE worker temporary token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=args.port,access_log=False)

if __name__=="__main__":
    main()
