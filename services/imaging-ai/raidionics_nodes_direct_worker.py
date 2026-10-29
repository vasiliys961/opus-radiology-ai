#!/usr/bin/env python3
"""Genuine original Raidionics CT_LymphNodes ONNX + original R231 lung mask.

One source HU DICOM-derived NIfTI, not an uploaded expert lung mask. Offline
private Linux research only; vendor CT_LymphNodes cannot detect cancer itself.
Source CT must be axial and have known contrast-enhanced mediastinal protocol.
"""
from __future__ import annotations
import argparse, asyncio, configparser, gzip, hashlib, importlib.metadata
import json, math, os, platform, secrets, shutil, signal, stat, sys, tempfile
import uuid, zipfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

MODEL_ARCHIVE_SHA="922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08"
LUNGMASK_SHA="d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"
VERSION="1.5.2"
SCHEMA="opus-original-raidionics-mediastinal-nodes-native-ct/v1"
CAPABILITY="opus-raidionics-mediastinal-direct-worker/v1"
MAX_BYTES=352+512*512*300*4
MIN_RAM=10*1024**3

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def verify_original_weights(model_zip,lungmask_weights):
    model=Path(model_zip);lungs=Path(lungmask_weights)
    if platform.system()!="Linux":
        raise ValueError("original_Raidionics_CPU_requires_Linux")
    for path,expected,limit in ((model,MODEL_ARCHIVE_SHA,120*1024**2),
                                (lungs,LUNGMASK_SHA,150*1024**2)):
        if (path.is_symlink() or not path.is_file() or
            path.stat().st_size<1024**2 or path.stat().st_size>limit or
            digest(path)!=expected):
            raise ValueError("original_model_weight_sha256_mismatch")
    if importlib.metadata.version("raidionicsseg")!=VERSION or (
        importlib.metadata.version("lungmask")!="0.2.20"):
        raise ValueError("publisher_CPU_model_package_version_mismatch")
    return model,lungs

def verified_model_archive(archive,destination):
    import os
    destination.mkdir(mode=0o700)
    total=0
    with zipfile.ZipFile(archive) as z:
        for entry in z.infolist():
            rel=Path(entry.filename)
            if (not entry.filename or rel.is_absolute() or ".." in rel.parts or
                "\\" in entry.filename or
                ((entry.external_attr>>16)&0o170000)==stat.S_IFLNK):
                raise ValueError("untrusted_publisher_model_archive_member")
            total+=entry.file_size
            if entry.file_size>500*1024**2 or total>1200*1024**2:
                raise ValueError("original_model_archive_expansion_budget")
            if entry.is_dir():continue
            output=destination.joinpath(*rel.parts)
            output.parent.mkdir(parents=True,exist_ok=True)
            with z.open(entry) as src,output.open("xb") as dst:
                shutil.copyfileobj(src,dst,1024*1024)
    paths=[ini.parent for ini in destination.rglob("pre_processing.ini")
           if list(ini.parent.rglob("*.onnx"))]
    if len(paths)!=1:
        raise ValueError("one_original_CT_LymphNodes_ONNX_model_required")
    return paths[0]

def axial_lungmask_request(source,image):
    import numpy as np
    from r231 import validate_request
    shape=image.shape
    affine=np.asarray(image.affine,dtype=float).copy()
    affine[:2,:]*=-1.0  # NIfTI RAS -> DICOM LPS
    req={
        "schema":"opus-analysis-request/v2",
        "requestId":str(uuid.uuid4()),"sourceIdentitySha256":digest(source),
        "inputSha256":digest(source),
        "geometry":{"dimensions":list(shape),"affineLps":affine[:3,:4].reshape(-1).tolist()},
        "modality":"CT","frameCount":shape[2],
        "input":{"format":"NIfTI-1","datatype":"float32",
                 "scalarValues":"cornerstone-decoded-no-additional-normalization"},
        "scope":"selected-series-only","sequence":"not-confirmed","coverage":"not-confirmed",
    }
    validate_request(req)  # Refuses oblique/nonaxial CT, mismatched geometry.
    return req

def candidate_nodes(binary,affine):
    import numpy as np
    from scipy import ndimage
    labels,total=ndimage.label(binary,structure=np.ones((3,3,3),dtype=np.uint8))
    if total>100000:raise ValueError("unbounded_native_node_instances")
    volume=abs(float(np.linalg.det(affine[:3,:3])))/1000
    nodes=[]
    for i,box in enumerate(ndimage.find_objects(labels),1):
        if box is None:continue
        component=labels[box]==i
        n=int(np.count_nonzero(component))
        if n<3:continue
        ijk=np.asarray(ndimage.center_of_mass(component))+[s.start for s in box]
        ras=(affine@np.r_[ijk,1])[:3]
        nodes.append({"nativeBoundsIJK":[[int(s.start),int(s.stop)-1] for s in box],
            "sourceCentroidIJK":[round(float(v),3) for v in ijk],
            "sourceRASmm":[round(float(v),3) for v in ras],
            "candidateVoxels":n,"candidateVolumeMl":round(n*volume,5),
            "nodeMalignancyAssessed":False})
        if len(nodes)>256:raise ValueError("too_many_unreviewed_model_nodes")
    nodes.sort(key=lambda n:n["candidateVoxels"],reverse=True)
    return nodes

async def subprocess_bounded(cmd,env,timeout_secs):
    process=await asyncio.create_subprocess_exec(*cmd,env=env,
        stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL,
        start_new_session=True)
    try:
        await asyncio.wait_for(process.wait(),timeout=timeout_secs)
        if process.returncode!=0:raise ValueError("original_pretrained_child_inference_failed")
    finally:
        if process.returncode is None:
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            await process.wait()

def create_app(*,token,origin,model_zip,lungmask_weights,port=8777):
    if not isinstance(token,str) or not 32<=len(token)<=128:
        raise ValueError("private_worker_token_required")
    if not isinstance(origin,str) or not (origin.startswith("http://127.0.0.1:")
        or origin.startswith("http://localhost:")):
        raise ValueError("private_browser_loopback_origin_required")
    if not 1024<=port<=65535:raise ValueError("private_loopback_port_required")
    original_zip,original_lung=verify_original_weights(model_zip,lungmask_weights)
    lock=asyncio.Lock()
    app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)

    @app.middleware("http")
    async def authenticate(req:Request,handler):
        h={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if req.headers.get("host")!=f"127.0.0.1:{port}" or req.headers.get("origin")!=origin:
            return JSONResponse({"detail":"origin_or_host_denied"},status_code=403,headers=h)
        h.update({"Access-Control-Allow-Origin":origin,"Vary":"Origin"})
        if req.method=="OPTIONS":
            headers={x.strip().lower() for x in req.headers.get(
                "access-control-request-headers","").split(",") if x.strip()}
            if (req.headers.get("access-control-request-method") not in ("GET","POST") or
                not headers.issubset({"authorization","content-type",
                    "x-opus-source-sha256","x-opus-enhanced-ct-confirmed"})):
                return Response(status_code=403,headers=h)
            h.update({"Access-Control-Allow-Methods":"GET,POST",
                "Access-Control-Allow-Headers":
                "Authorization,Content-Type,X-Opus-Source-Sha256,X-Opus-Enhanced-CT-Confirmed",
                "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=h)
        if not secrets.compare_digest(req.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401,headers=h)
        out=await handler(req);out.headers.update(h);return out

    @app.get("/v1/nodes/capabilities")
    async def capabilities():
        import psutil
        return {"schema":CAPABILITY,"model":"Raidionics CT_LymphNodes ONNX v13",
           "modelArchiveSHA256":MODEL_ARCHIVE_SHA,"lungmaskWeightSHA256":LUNGMASK_SHA,
           "modelArchiveVerified":digest(original_zip)==MODEL_ARCHIVE_SHA,
           "lungmaskVerified":digest(original_lung)==LUNGMASK_SHA,
           "raidionicssegVersion":VERSION,"lungmaskVersion":"0.2.20",
           "ready":psutil.virtual_memory().available>=MIN_RAM,
           "mode":"isolated-private-linux-cpu-research",
           "protocol":"contrast-enhanced-chest-CT-confirmed-by-physician",
           "patientMode":False,"dataPolicy":"public-nonpatient-only"}

    @app.post("/v1/nodes/analyze")
    async def analyze(req:Request):
        if lock.locked():raise HTTPException(409,"nodes_model_busy")
        if req.headers.get("x-opus-enhanced-ct-confirmed")!="yes":
            raise HTTPException(403,"contrast_chest_protocol_not_authorized")
        if req.headers.get("content-type")!="application/octet-stream":
            raise HTTPException(415,"original_HU_NIfTI_required")
        source_sha=req.headers.get("x-opus-source-sha256","")
        if len(source_sha)!=64 or any(ch not in "0123456789abcdef" for ch in source_sha):
            raise HTTPException(422,"source_sha256_required")
        if int(req.headers.get("content-length","0") or 0)>MAX_BYTES:
            raise HTTPException(413,"source_exceeds_CT_limit")
        async with lock:
            import nibabel as nib
            import numpy as np
            import psutil
            if psutil.virtual_memory().available<MIN_RAM:
                raise HTTPException(507,"requires_10GiB_free_RAM")
            if (digest(original_zip)!=MODEL_ARCHIVE_SHA or digest(original_lung)!=LUNGMASK_SHA):
                raise HTTPException(503,"original_installed_weight_changed")
            with tempfile.TemporaryDirectory(prefix="opus-raidionics-original-") as temp:
                root=Path(temp);src=root/"source.nii";h=hashlib.sha256();bytes_count=0
                with src.open("xb") as stream:
                    async for chunk in req.stream():
                        bytes_count+=len(chunk)
                        if bytes_count>MAX_BYTES:raise HTTPException(413,"CT_source_too_large")
                        h.update(chunk);stream.write(chunk)
                if bytes_count<353 or bytes_count!=src.stat().st_size or h.hexdigest()!=source_sha:
                    raise HTTPException(422,"original_CT_identity_changed")
                image=nib.load(str(src))
                if (image.ndim!=3 or math.prod(image.shape)>512*512*300 or
                    image.header.get_xyzt_units()[0]!="mm" or
                    not np.isfinite(image.affine).all() or
                    abs(float(np.linalg.det(image.affine[:3,:3])))<1e-6):
                    raise HTTPException(422,"original_nifti_geometry_invalid")
                try:request= axial_lungmask_request(src,image)
                except ValueError:
                    raise HTTPException(422,"R231_requires_axis_aligned_CT") from None
                task=root/"r231";task.mkdir(mode=0o700)
                # Hard link same original native input; NO second source conversion.
                os.link(src,task/"input.nii")
                (task/"request.json").write_text(json.dumps(request))
                modeldir=verified_model_archive(original_zip,root/"model-release")
                env={k:v for k,v in os.environ.items() if k in
                    ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH",
                    "OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS")}
                env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1",
                            "HF_HUB_DISABLE_TELEMETRY":"1"})
                await subprocess_bounded(
                    [sys.executable,str(Path(__file__).with_name("r231.py")),
                     str(task),str(original_lung),"safe"],env,1100)
                mask=task/"mask.nii"
                if not mask.is_file() or mask.stat().st_size!=352+math.prod(image.shape):
                    raise HTTPException(422,"original_R231_lungmask_missing_or_not_native")
                inputs=root/"inputs";inputs.mkdir(mode=0o700)
                source_nifti=inputs/"original_input0.nii.gz"
                lung_nifti=inputs/"original_label_Lungs.nii.gz"
                for original,compressed in ((src,source_nifti),(mask,lung_nifti)):
                    with original.open("rb") as inp,gzip.open(compressed,"xb",compresslevel=1) as out:
                        shutil.copyfileobj(inp,out,1024*1024)
                lung_img=nib.load(str(lung_nifti))
                if (lung_img.shape!=image.shape or
                    not np.allclose(lung_img.affine,image.affine,atol=.001,rtol=0) or
                    not np.isin(np.asarray(lung_img.dataobj),[0,1,2]).all() or
                    np.count_nonzero(np.asarray(lung_img.dataobj))<1000):
                    raise HTTPException(422,"original_R231_lungs_not_in_source_native_grid")
                output=root/"outputs";output.mkdir(mode=0o700)
                cfg=configparser.ConfigParser()
                cfg["System"]={"gpu_id":"-1","acceleration":"cpu",
                    "inputs_folder":str(inputs),"output_folder":str(output),
                    "model_folder":str(modeldir)}
                cfg["Runtime"]={"batch_size":"1","folds_ensembling":"False",
                    "ensembling_strategy":"average","overlapping_ratio":"0.",
                    "reconstruction_method":"thresholding",
                    "reconstruction_order":"resample_first",
                    "use_preprocessed_data":"False",
                    "test_time_augmentation_iteration":"0",
                    "test_time_augmentation_fusion_mode":"average"}
                cfg["Mediastinum"]={"lungs_segmentation_filename":str(lung_nifti)}
                config=root/"config.ini"
                with config.open("w") as out:cfg.write(out)
                await subprocess_bounded([sys.executable,"-m","raidionicsseg",str(config)],env,1100)
                predictions=list(output.glob("labels_LymphNodes.nii.gz"))
                if len(predictions)!=1 or predictions[0].stat().st_size>256*1024**2:
                    raise HTTPException(422,"original_node_model_mask_missing")
                prediction=nib.load(str(predictions[0]))
                if (prediction.shape!=image.shape or
                    not np.allclose(prediction.affine,image.affine,atol=.001,rtol=0)):
                    raise HTTPException(422,"trained_node_mask_misaligned")
                labels=np.asarray(prediction.dataobj)
                if labels.dtype.kind not in "ui" or not np.isin(labels,[0,1]).all():
                    raise HTTPException(422,"unexpected_original_lymphnode_labels")
                nodes=candidate_nodes(labels==1,image.affine)
                return {"schema":SCHEMA,
                    "task":"mediastinal_lymph_nodes",
                    "model":"Raidionics CT_LymphNodes ONNX v13",
                    "sourceNiftiSHA256":source_sha,
                    "sourceNativeShapeXYZ":list(image.shape),
                    "originalModelArchiveSHA256":MODEL_ARCHIVE_SHA,
                    "originalLungmaskSHA256":LUNGMASK_SHA,
                    "sourceAlignedLungmaskSHA256":digest(mask),
                    "modelPredictionNativeMaskSHA256":digest(predictions[0]),
                    "actualOriginalRaidionicsInferenceCompleted":True,
                    "actualOriginalR231InferenceCompleted":True,
                    "modelPositiveVoxels":int(np.count_nonzero(labels)),
                    "candidates":nodes,"nodeMalignancyConfirmed":False,
                    "clinicalValidation":False,"negativeLymphadenopathyConclusionPermitted":False,
                    "sourceDICOMFrameRegistrationVerified":False,
                    "limitations":[
                     "Original published lymph node ONNX was previously tested on vendor sample only.",
                     "Original R231 lungmask is prerequisite anatomy, NOT another pathology detector.",
                     "Cannot differentiate metastases, inflammation or primary mediastinal tumors.",
                     "Source model/native voxel geometry verified; exact DICOM SOP correspondence pending.",
                     "Research-only nonpatient contrast CT. No clinical sensitivity established.",
                    ]}
    return app

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--model-archive",required=True)
    p.add_argument("--lungmask-weights",required=True)
    p.add_argument("--origin",default="http://127.0.0.1:3000")
    p.add_argument("--port",type=int,default=8777)
    args=p.parse_args()
    token=secrets.token_urlsafe(36).replace("-","_")
    app=create_app(token=token,origin=args.origin,model_zip=args.model_archive,
                   lungmask_weights=args.lungmask_weights,port=args.port)
    print("Raidionics original research worker token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=args.port,access_log=False)

if __name__=="__main__":
    main()
