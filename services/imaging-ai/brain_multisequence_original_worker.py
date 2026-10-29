#!/usr/bin/env python3
"""Original pretrained MRI brain pathology task worker (ISLES22 or BraTS).

Source is EXACT DICOM-to-NIfTI per MR sequence, with operator-confirmed names;
no DWI/ADC/FLAIR/T1/T2 sequence guessing. One original trained model per task.
Research-only local loopback Linux CPU, original publisher checkpoint SHAs.
"""
from __future__ import annotations
import argparse, asyncio, hashlib, importlib.metadata, json, math, os, platform
import secrets, signal, struct, sys, tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

ISLES_MODEL_SHA="f9023888c7fe616ff271559acb82addd2496581fddd0a94e2d3c80bada5bb7e9"
BRATS_MODEL_SHA="860ccb3f1c21c99d0410ad8a1ac4ef6b8fab60cec0a503b0ba42675741a750ae"
CAPABILITY="opus-original-brain-multisequence-worker/v1"
SCHEMA="opus-original-brain-real-pathology-result/v1"
TASKS={"stroke":("dwi","adc","flair"),
       "glioma":("t1ce","t1","t2","flair")}
MAX_FILE=352+512*512*300*4
MAX_PAYLOAD=4*MAX_FILE+8192
MIN_RAM=12*1024**3

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def verified_models(stroke_folder=None,glioma_checkpoint=None):
    if platform.system()!="Linux":raise ValueError("private_original_brain_CPU_Linux_required")
    available={}
    if stroke_folder is not None:
        path=Path(stroke_folder)
        model=path/"fold_0/checkpoint_best.pth"
        if (path.is_symlink() or not path.is_dir() or not (path/"dataset.json").is_file()
            or not (path/"plans.json").is_file() or model.is_symlink() or not model.is_file()
            or digest(model)!=ISLES_MODEL_SHA):
            raise ValueError("original_ISLES22_nnUNet_fold0_checkpoint_unverified")
        available["stroke"]=str(path)
    if glioma_checkpoint is not None:
        path=Path(glioma_checkpoint)
        if (path.is_symlink() or not path.is_file() or
            not 1*1024**2<path.stat().st_size<900*1024**2 or
            digest(path)!=BRATS_MODEL_SHA):
            raise ValueError("original_MONAI_BraTS_SegResNet_checkpoint_unverified")
        available["glioma"]=str(path)
    if not available:raise ValueError("no_original_pretrained_brain_model_installed")
    return available

def verify_original_mr(path,role):
    import nibabel as nib
    import numpy as np
    image=nib.load(str(path),mmap=True)
    affine=np.asarray(image.affine)
    if (image.ndim!=3 or not 8<=min(image.shape) or
        math.prod(image.shape)>512*512*300 or
        image.header.get_xyzt_units()[0]!="mm" or
        not np.isfinite(affine).all() or
        abs(float(np.linalg.det(affine[:3,:3])))<1e-6):
        raise ValueError("original_MRI_"+role+"_native_grid_invalid")
    # Input signal must be finite: random image or real CT cannot be detected
    # by header metadata alone; operator sequence admission remains mandatory.
    for k in range(image.shape[2]):
        data=np.asarray(image.dataobj[:,:,k])
        if not np.isfinite(data).all():
            raise ValueError("original_MRI_nonfinite_signal")
    return image

def candidate_components(mask,affine,minimum=3):
    import numpy as np
    from scipy import ndimage
    m=np.asarray(mask)
    labels,count=ndimage.label(m,structure=np.ones((3,3,3),dtype=np.uint8))
    if count>200000:raise ValueError("unbounded_brain_pathology_components")
    voxel_ml=abs(float(np.linalg.det(affine[:3,:3])))/1000
    candidates=[]
    for i,sl in enumerate(ndimage.find_objects(labels),1):
        if sl is None:continue
        block=labels[sl]==i
        n=int(np.count_nonzero(block))
        if n<minimum:continue
        center=np.asarray(ndimage.center_of_mass(block))+[s.start for s in sl]
        ras=(affine@np.r_[center,1])[:3]
        candidates.append({
          "nativeBoundsIJK":[[int(x.start),int(x.stop)-1] for x in sl],
          "nativeCenterIJK":[round(float(x),3) for x in center],
          "nativeCenterRASmm":[round(float(x),3) for x in ras],
          "candidateVoxels":n,"candidateVolumeMl":round(n*voxel_ml,5),
          "expertDiagnosisConfirmed":False,
        })
        if len(candidates)>256:raise ValueError("too_many_brain_lesion_components")
    candidates.sort(key=lambda x:x["candidateVoxels"],reverse=True)
    return candidates

def run_stroke(root,model_dir,originals,output):
    import shutil
    import numpy as np
    import nibabel as nib
    import torch
    from nibabel.processing import resample_from_to
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
    if importlib.metadata.version("nnunetv2")!="2.8.1":
        raise ValueError("published_nnunetv2_inference_runtime_mismatch")
    dwi=verify_original_mr(originals["dwi"],"dwi")
    if math.prod(dwi.shape)>14_000_000:
        raise ValueError("original_DWI_model_source_exceeds_ISLES_public_budget")
    registered=root/"registered";registered.mkdir()
    for i,role in enumerate(TASKS["stroke"]):
        image=verify_original_mr(originals[role],role)
        if image.shape!=dwi.shape or not np.allclose(image.affine,dwi.affine,atol=.001,rtol=0):
            image=resample_from_to(image,dwi,order=1)
        native=np.asarray(image.dataobj,dtype=np.float32)
        if not np.isfinite(native).all() or native.max()<=native.min():
            raise ValueError("original_ISLES_MRI_channel_signal_missing")
        nib.save(nib.Nifti1Image(native,dwi.affine),
                 str(registered/f"stroke_000{i}.nii.gz"))
    output_dir=root/"predicted"
    output_dir.mkdir()
    torch.set_num_threads(2)
    predictor=nnUNetPredictor(tile_step_size=.8,use_gaussian=True,
        use_mirroring=False,perform_everything_on_device=False,
        device=torch.device("cpu"),verbose=False,
        verbose_preprocessing=False,allow_tqdm=False)
    predictor.initialize_from_trained_model_folder(model_dir,use_folds=(0,),
        checkpoint_name="checkpoint_best.pth")
    predictor.predict_from_files(str(registered),str(output_dir),
        save_probabilities=False,overwrite=True,
        num_processes_preprocessing=1,num_processes_segmentation_export=1)
    prediction=output_dir/"stroke.nii.gz"
    if not prediction.is_file():raise ValueError("actual_original_ISLES22_forward_missing")
    source=nib.load(str(prediction))
    if (source.shape!=dwi.shape or not np.allclose(source.affine,dwi.affine,atol=.1,rtol=0)):
        raise ValueError("original_ISLES22_mask_not_DWI_native")
    data=np.asarray(source.dataobj)
    if not np.isin(data,[0,1]).all():raise ValueError("original_ISLES22_binary_mask_invalid")
    masks={"ischemic_stroke":data==1}
    return dwi,masks,{"strokeMaskSha256":digest(prediction)}

def run_glioma(root,checkpoint,originals,output):
    import nibabel as nib
    import numpy as np
    import torch
    from monai.networks.nets import SegResNet
    from monai.inferers import sliding_window_inference
    from monai.transforms import NormalizeIntensity
    if importlib.metadata.version("monai") not in ("1.5.1","1.5.0"):
        raise ValueError("original_MONAI_brats_runtime_mismatch")
    imgs=[verify_original_mr(originals[k],k) for k in TASKS["glioma"]]
    reference=imgs[0]
    # Published BraTS research inference requires 4 originally coregistered
    # brain volumes. DO NOT silently treat unregistered MRI as aligned.
    if reference.shape!=(240,240,155) or any(
        im.shape!=reference.shape or not np.allclose(
         im.affine,reference.affine,atol=.001,rtol=0) for im in imgs):
        raise ValueError("four_original_BraTS_sequences_not_registered_or_not_BraTS_shape")
    stacked=np.stack([np.asarray(im.dataobj,dtype=np.float32) for im in imgs])
    if not np.isfinite(stacked).all() or any(
        stacked[c].max()<=stacked[c].min() for c in range(4)):
        raise ValueError("actual_BraTS_MRI_signal_missing")
    normalized=NormalizeIntensity(nonzero=True,channel_wise=True)(stacked)
    x=torch.from_numpy(np.ascontiguousarray(np.asarray(normalized)[None])).float()
    model=SegResNet(spatial_dims=3,init_filters=16,in_channels=4,out_channels=3,
                    dropout_prob=.2,blocks_down=(1,2,2,4),blocks_up=(1,1,1))
    state=torch.load(str(checkpoint),map_location="cpu",weights_only=True)
    state=state.get("model",state) if isinstance(state,dict) else None
    if not isinstance(state,dict):
        raise ValueError("official_original_BraTS_checkpoint_incompatible")
    model.load_state_dict(state,strict=True)
    model.eval();torch.set_num_threads(2)
    with torch.inference_mode():
        scores=sliding_window_inference(x,roi_size=(240,240,160),
            sw_batch_size=1,predictor=model,overlap=.5,
            sw_device=torch.device("cpu"),device=torch.device("cpu"))
        probs=torch.sigmoid(scores)[0].cpu().numpy()
    return reference,{"tumor_core":probs[0]>.5,"whole_tumor":probs[1]>.5,
        "enhancing_tumor":probs[2]>.5},{"channelOrder":list(TASKS["glioma"])}

def infer_job(root,task,model,expected_sha):
    import numpy as np
    path=Path(root)
    data=json.loads((path/"request.json").read_text())
    if (data.get("schema")!="opus-native-dicom-brain-mri-batch/v1" or
        data.get("task")!=task or task not in TASKS or
        [r.get("role") for r in data.get("files",[])]!=list(TASKS[task])):
        raise ValueError("not_original_series_brain_task")
    original={}
    for role in TASKS[task]:
        p=path/(role+".nii")
        info=next(x for x in data["files"] if x["role"]==role)
        if digest(p)!=info["sha256"]:raise ValueError("MRI_source_sha256_changed")
        original[role]=p
    if task=="stroke":
        check=Path(model)/"fold_0/checkpoint_best.pth"
    else:check=Path(model)
    if not check.is_file() or digest(check)!=expected_sha:
        raise ValueError("original_brain_pretrained_checkpoint_sha_changed")
    if task=="stroke":ref,masks,extra=run_stroke(path,model,original,path/"output.json")
    else:ref,masks,extra=run_glioma(path,model,original,path/"output.json")
    found={}
    for name,mask in masks.items():
        found[name]={"sourcePositiveVoxels":int(np.count_nonzero(mask)),
                     "components":candidate_components(mask,ref.affine)}
    report={
       "schema":SCHEMA,"task":task,
       "model":"original ISLES22 nnU-Net v2 fold 0" if task=="stroke"
          else "original MONAI BraTS SegResNet 3 subregions",
       "originalCheckpointSha256":expected_sha,
       "originalSequenceSha256":{x["role"]:x["sha256"] for x in data["files"]},
       "sourceReferenceRole":"dwi" if task=="stroke" else "t1ce",
       "sourceReferenceShapeXYZ":list(ref.shape),
       "outputNativeSourceGridVerified":True,
       "actualPretrainedModelForwardCompleted":True,
       "modelRegions":found,
       "clinicalValidation":False,"negativeDiagnosisPermitted":False,
       "originalDICOM_SOPRegistrationVerified":False,
       "operatorConfirmedSequenceNamesNotDerivedFromDICOM":True,
       "limitations":[
         "Original research MRI sequence assignment explicitly confirmed by operator.",
         "ISLES DWI/ADC/FLAIR registration performed to DWI for trained model."
           if task=="stroke" else "BraTS model restricted to registered original 240x240x155 volumes.",
         "One previously observed real research case per task, not independent diagnostic validation.",
         "Negative disease assertion and automatic cancer/ischemia clinical diagnosis prohibited.",
         "Actual pixel/ROI interpretation can be reconciled with privacy-approved Gemini/Opus, not validated thereby.",
         "Native DICOM SOP mapping not established by this NIfTI report.",
       ],**extra}
    (path/"output.json").write_text(json.dumps(report))
    return report

async def receive_original_sources(request,root):
    # Layout: uint32 header length | UTF8 JSON manifest | concatenated exact
    # individual original NIfTI byte streams. No multipart/temp huge RAM copies.
    iterator=request.stream().__aiter__();buffer=bytearray()
    async def take(count,writer=None,hasher=None):
        nonlocal buffer
        received=0
        while received<count:
            if not buffer:
                try:buffer.extend(await anext(iterator))
                except StopAsyncIteration:raise HTTPException(422,"incomplete_original_MRI_stream")
            n=min(count-received,len(buffer))
            if writer:writer.write(memoryview(buffer)[:n])
            if hasher:hasher.update(memoryview(buffer)[:n])
            del buffer[:n];received+=n
        return received
    head=bytearray()
    await take(4,writer=_BytearrayWriter(head))
    length=struct.unpack("<I",head)[0]
    if length<32 or length>8192:raise HTTPException(422,"unbounded_MRI_manifest")
    body=bytearray()
    await take(length,writer=_BytearrayWriter(body))
    try:manifest=json.loads(body.decode("utf-8"))
    except (UnicodeError,ValueError):
        raise HTTPException(422,"invalid_MRI_manifest") from None
    task=manifest.get("task")
    if manifest.get("schema")!="opus-native-dicom-brain-mri-batch/v1" or task not in TASKS:
        raise HTTPException(422,"unsupported_brain_pathology_task")
    files=manifest.get("files")
    if not isinstance(files,list) or [x.get("role") for x in files]!=list(TASKS[task]):
        raise HTTPException(422,"expected_original_MRI_sequence_order")
    if len({x["role"] for x in files})!=len(files):
        raise HTTPException(422,"duplicate_MRI_sequence")
    for item in files:
        size=item.get("bytes");sha=item.get("sha256")
        if (not isinstance(size,int) or size<352 or size>MAX_FILE or
            not isinstance(sha,str) or len(sha)!=64 or
            any(c not in "0123456789abcdef" for c in sha)):
            raise HTTPException(422,"invalid_MR_source_size_or_digest")
    if sum(x["bytes"] for x in files)>MAX_PAYLOAD:
        raise HTTPException(413,"MRI_study_exceeds_private_worker_limit")
    for item in files:
        h=hashlib.sha256()
        output=root/(item["role"]+".nii")
        with output.open("xb") as out:
            await take(item["bytes"],writer=out,hasher=h)
        if h.hexdigest()!=item["sha256"]:
            raise HTTPException(422,"MR_sequence_digest_mismatch")
    if buffer:raise HTTPException(422,"trailing_MRI_bytes")
    async for tail in iterator:
        if tail:raise HTTPException(422,"trailing_MRI_bytes")
    return manifest

class _BytearrayWriter:
    def __init__(self,b):self.b=b
    def write(self,chunk):self.b.extend(chunk)

def create_app(*,token,origin,stroke_folder=None,glioma_checkpoint=None,port=8778):
    if not isinstance(token,str) or not 32<=len(token)<=128:
        raise ValueError("private_MRI_worker_token_required")
    if not isinstance(origin,str) or not (origin.startswith("http://127.0.0.1:")
        or origin.startswith("http://localhost:")):
        raise ValueError("local_MRI_browser_origin_required")
    if not 1024<=port<=65535:raise ValueError("local_MRI_loopback_port_required")
    installed=verified_models(stroke_folder,glioma_checkpoint)
    lock=asyncio.Lock();app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
    @app.middleware("http")
    async def auth(req:Request,handler):
        h={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
        if req.headers.get("host")!=f"127.0.0.1:{port}" or req.headers.get("origin")!=origin:
            return JSONResponse({"detail":"MRI_browser_origin_or_host_denied"},status_code=403,headers=h)
        h.update({"Access-Control-Allow-Origin":origin,"Vary":"Origin"})
        if req.method=="OPTIONS":
            fields={v.strip().lower() for v in req.headers.get("access-control-request-headers","").split(",") if v.strip()}
            if (req.headers.get("access-control-request-method") not in ("GET","POST") or
                not fields.issubset({"authorization","content-type","x-opus-mri-source-authorized"})):
                return Response(status_code=403,headers=h)
            h.update({"Access-Control-Allow-Headers":"Authorization,Content-Type,X-Opus-MRI-Source-Authorized",
                      "Access-Control-Allow-Methods":"GET,POST",
                      "Access-Control-Allow-Private-Network":"true"})
            return Response(status_code=204,headers=h)
        if not secrets.compare_digest(req.headers.get("authorization",""),"Bearer "+token):
            return JSONResponse({"detail":"unauthorized"},status_code=401,headers=h)
        out=await handler(req);out.headers.update(h);return out
    @app.get("/v1/brain/capabilities")
    async def capabilities():
        import psutil
        return {"schema":CAPABILITY,"mode":"isolated-linux-cpu-research",
            "patientMode":False,"dataPolicy":"public-nonpatient-only",
            "originalDICOMWeightingAutoInferred":False,
            "ready":psutil.virtual_memory().available>=MIN_RAM,
            "installedTasks":{task:{"checkpointSha256":
                ISLES_MODEL_SHA if task=="stroke" else BRATS_MODEL_SHA,
                "installedAndHashVerified":True} for task in installed}}
    @app.post("/v1/brain/analyze")
    async def analyze(req:Request):
        if lock.locked():raise HTTPException(409,"real_brain_worker_busy")
        if (req.headers.get("content-type")!="application/octet-stream" or
            req.headers.get("x-opus-mri-source-authorized")!="approved-public-nonpatient"):
            raise HTTPException(403,"original_MRI_source_authorization_required")
        if int(req.headers.get("content-length","0") or 0)>MAX_PAYLOAD:
            raise HTTPException(413,"MR_source_oversize")
        async with lock:
            import psutil
            if psutil.virtual_memory().available<MIN_RAM:
                raise HTTPException(507,"brain_nnUNet_requires_12GiB_RAM")
            with tempfile.TemporaryDirectory(prefix="opus-original-brain-") as folder:
                root=Path(folder)
                manifest=await receive_original_sources(req,root)
                task=manifest["task"]
                if task not in installed:
                    raise HTTPException(503,"original_brain_detector_checkpoint_not_installed")
                model=installed[task]
                expected=ISLES_MODEL_SHA if task=="stroke" else BRATS_MODEL_SHA
                checkpoint=Path(model)/"fold_0/checkpoint_best.pth" if task=="stroke" else Path(model)
                if digest(checkpoint)!=expected:
                    raise HTTPException(503,"original_model_weight_drift")
                (root/"request.json").write_text(json.dumps(manifest))
                cmd=[sys.executable,str(Path(__file__)),"--infer","--job",str(root),
                     "--task",task,"--model",model,"--expected-sha",expected]
                env={k:v for k,v in os.environ.items() if k in
                    ("PATH","HOME","TMPDIR","LANG","LC_ALL","LD_LIBRARY_PATH",
                     "OMP_NUM_THREADS","MKL_NUM_THREADS","OPENBLAS_NUM_THREADS",
                     "nnUNet_raw","nnUNet_preprocessed","nnUNet_results")}
                env.update({"HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1","HF_HUB_DISABLE_TELEMETRY":"1"})
                proc=await asyncio.create_subprocess_exec(*cmd,env=env,
                    stdout=asyncio.subprocess.DEVNULL,stderr=asyncio.subprocess.DEVNULL,
                    start_new_session=True)
                try:
                    await asyncio.wait_for(proc.wait(),timeout=2300)
                    output=root/"output.json"
                    if proc.returncode!=0 or not output.is_file() or output.stat().st_size>512*1024:
                        raise HTTPException(422,"original_brain_model_inference_failed")
                    report=json.loads(output.read_text())
                    if (report.get("schema")!=SCHEMA or report.get("task")!=task or
                        report.get("originalCheckpointSha256")!=expected or
                        report.get("originalSequenceSha256")!={x["role"]:x["sha256"] for x in manifest["files"]} or
                        report.get("actualPretrainedModelForwardCompleted") is not True or
                        report.get("negativeDiagnosisPermitted") is not False):
                        raise HTTPException(422,"source_or_original_model_result_not_verified")
                    return report
                finally:
                    if proc.returncode is None:
                        try:os.killpg(proc.pid,signal.SIGKILL)
                        except ProcessLookupError:pass
                        await proc.wait()
    return app

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--stroke-model-folder")
    p.add_argument("--glioma-checkpoint")
    p.add_argument("--origin",default="http://127.0.0.1:3000")
    p.add_argument("--port",type=int,default=8778)
    p.add_argument("--infer",action="store_true")
    p.add_argument("--job");p.add_argument("--task");p.add_argument("--model");p.add_argument("--expected-sha")
    a=p.parse_args()
    if a.infer:
        infer_job(a.job,a.task,a.model,a.expected_sha)
        return
    token=secrets.token_urlsafe(36).replace("-","_")
    app=create_app(token=token,origin=a.origin,stroke_folder=a.stroke_model_folder,
                   glioma_checkpoint=a.glioma_checkpoint,port=a.port)
    print("Original MRI brain worker token: "+token,flush=True)
    import uvicorn
    uvicorn.run(app,host="127.0.0.1",port=a.port,access_log=False)
if __name__=="__main__":
    main()
