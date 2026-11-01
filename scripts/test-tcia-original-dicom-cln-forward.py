#!/usr/bin/env python3
"""Actual TCIA LCTSC 103 *scanner-original* DICOM -> private CLN original weights.

Validates original DICOM file SHA chain and native source/physical SOP mapping.
No patient pixels, DICOM UIDs, private credentials or model files enter artifacts.
Zero model candidates is a valid completed forward, never a negative diagnosis.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time
import numpy as np
import pydicom

ROOT=Path(__file__).resolve().parents[1]
BASE="http://127.0.0.1:8783/v1/cln"
EXPECTED_MODEL="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
CHAIN="bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61"
def load(path):
    spec=importlib.util.spec_from_file_location("opus_tcia_module_"+path.stem.replace("-","_"),path)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod

def run(reference:Path,work:Path,numeric:Path,local_map:Path):
    import requests
    from hashlib import sha256
    import shutil
    if any(p.exists() for p in (work,numeric,local_map)):
        raise ValueError("new_only_private_worker_sources_required")
    manifest=json.loads((reference/"reference.json").read_text())
    pinned=load(ROOT/"scripts/download-r231-browser-reference.py")
    if (manifest.get("schema")!="opus-r231-browser-reference/v1" or
        manifest.get("collection")!="TCIA LCTSC" or
        manifest.get("license")!="CC BY 3.0" or
        manifest.get("sourceContentChainSha256")!=CHAIN or
        manifest.get("selectedFrames")!=103 or manifest.get("allSourceFrames") is not True or
        manifest.get("selectedFileSha256") is None or
        len(manifest["selectedFileSha256"])!=103):
        raise ValueError("unverified_original_TCIA_DICOM_source")
    files=sorted((reference/"dicom").glob("reference-*.dcm"))
    if len(files)!=103:raise ValueError("not_103_original_DICOM_files")
    hashbytes=[]
    for i,p in enumerate(files):
        if p.name!=f"reference-{i:03}.dcm" or p.is_symlink():
            raise ValueError("nonoriginal_DICOM_file")
        h=sha256(p.read_bytes()).digest()
        if h.hex()!=manifest["selectedFileSha256"][i]:raise ValueError("source_file_SHA_mismatch")
        hashbytes.append(h)
    if sha256(b"".join(hashbytes)).hexdigest()!=CHAIN:
        raise ValueError("TCIA_source_chain_changed")
    work.mkdir(parents=True,exist_ok=False)
    converter=load(ROOT/"services/imaging-ai/chest_dicom_to_monai.py")
    native=work/"source-original-tcia-dicom.nii"
    source=converter.convert_dicom_chest(reference/"dicom",native,
                                         public_rights=True,deidentified=True)
    if source.get("dimensions") != (512,512,103):
        raise ValueError("unexpected_TCIA_native_CT")
    # Bind every original SOP to the exact native NIfTI z-slice after affine check.
    import nibabel as nib
    n=nib.load(str(native))
    original=[]
    for p in files:
        ds=pydicom.dcmread(str(p))
        original.append((float(ds.ImagePositionPatient[2]),ds))
    original.sort(key=lambda item:item[0])
    sops=[str(d.SOPInstanceUID) for _,d in original]
    if len(set(sops))!=103:raise ValueError("duplicate_original_TCIA_SOP")
    for z in (0,25,51,77,102):
        ds=original[z][1]
        array=ds.pixel_array.astype(np.float32)*float(ds.RescaleSlope)+float(ds.RescaleIntercept)
        actual=np.asarray(n.dataobj[:,:,z],dtype=np.float32)
        if not np.array_equal(actual,array.T):
            raise ValueError("original_DICOM_pixels_do_not_match_CLN_native")
        # NIfTI has RAS, DICOM ImagePositionPatient has LPS.
        actual_lps=np.asarray(n.affine[:3,3]+z*n.affine[:3,2],dtype=float)
        actual_lps[:2]*=-1
        if np.linalg.norm(actual_lps-np.asarray(ds.ImagePositionPatient,dtype=float))>.06:
            raise ValueError("original_SOP_world_z_binding_failed")
    local_map.write_text(json.dumps({
      "schema":"opus-tcia-original-dicom-cln-map/v1",
      "sourceNativeSha256":source["sha256"],
      "sourceDICOMChainSha256":CHAIN,
      "originalScannerDicom":True,"sourceSopGeometryVerified":True,
      "dimensions":[512,512,103],"nativeSopInstanceUids":sops,
    })+"\n")
    helper=load(ROOT/"scripts/test-cln-original-http-public-positive.py")
    helper.preflight()
    model=load(ROOT/"scripts/cln-msd-original-positive-public-ct.py").load_cln()
    model_root=work/"models"
    outcome=model.provision(model_root/model.TASK/model.TRAINER)
    if outcome["checkpointSHA256"]!=EXPECTED_MODEL or outcome["publisherLfsWeightSHA256Verified"] is not True:
        raise ValueError("untrusted_original_CLN_weights")
    token=secrets.token_urlsafe(48)
    env=os.environ.copy()
    env.update({
      "OPUS_CLN_MODEL_ROOT":str(model_root),
      "OPUS_CLN_CHECKPOINT_SHA256":EXPECTED_MODEL,
      "OPUS_CLN_WORKER_TOKEN":token,
      "OPUS_CLN_WORKER_ORIGIN":"http://127.0.0.1:3000",
      "nnUNet_results":str(model_root),
      "nnUNet_raw":str(work/"nnunet-raw"),
      "nnUNet_preprocessed":str(work/"nnunet-preprocessed"),
      "OMP_NUM_THREADS":"2","MKL_NUM_THREADS":"2","CUDA_VISIBLE_DEVICES":"-1",
    })
    headers={"Authorization":"Bearer "+token,"Origin":"http://127.0.0.1:3000"}
    process=None;job=None
    try:
        with (work/"private-worker.log").open("wb") as log:
            process=subprocess.Popen([sys.executable,str(ROOT/"services/imaging-ai/cln_native_upload_worker.py")],
                cwd=str(ROOT),env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
        session=requests.Session()
        deadline=time.monotonic()+90
        while time.monotonic()<deadline:
            if process.poll() is not None:raise RuntimeError("original_CLN_worker_died")
            try:
                response=session.get(BASE+"/capabilities",headers=headers,timeout=5)
                if response.ok:break
            except requests.RequestException:pass
            time.sleep(1)
        else:raise TimeoutError("original_CLN_worker_unavailable")
        capability=response.json()
        if (capability.get("originalWeightsVerified") is not True or
            capability.get("checkpointSha256")!=EXPECTED_MODEL or
            capability.get("patientMode") is not False):
            raise ValueError("original_weights_not_running")
        if session.get(BASE+"/capabilities",headers={"Origin":headers["Origin"]},timeout=10).status_code!=403:
            raise ValueError("worker_unauthorized_access_exposed")
        with native.open("rb") as data:
            started=session.post(BASE+"/upload",headers={**headers,"Content-Type":"application/octet-stream",
                "X-Opus-Source-Sha256":source["sha256"],
                "X-Opus-Public-Research-Authorization":"approved-nonpatient-source"},
                data=data,timeout=150)
        started.raise_for_status()
        job=started.json().get("jobId")
        if not isinstance(job,str) or len(job)!=36:raise ValueError("unbound_CLN_model_job")
        deadline=time.monotonic()+3400
        while time.monotonic()<deadline:
            reply=session.get(BASE+"/jobs/"+job,headers=headers,timeout=30)
            reply.raise_for_status()
            state=reply.json()
            if state.get("state")=="succeeded":break
            if state.get("state")!="running":raise RuntimeError("CLN_forward_failed:"+str(state.get("reason"))[:80])
            if process.poll() is not None:raise RuntimeError("private_worker_exited_during_forward")
            time.sleep(7)
        else:raise TimeoutError("real_original_CLN_forward_timed_out")
        reply=session.get(BASE+"/jobs/"+job+"/report",headers=headers,timeout=25)
        reply.raise_for_status();result=reply.json()
        if (result.get("schema")!="opus-original-cln-upload-result/v1" or
            result.get("sourceNiftiSha256")!=source["sha256"] or
            result.get("checkpointSha256")!=EXPECTED_MODEL or
            result.get("realOriginalModelForwardCompleted") is not True or
            result.get("researchOnly") is not True or result.get("clinicalValidation") is not False or
            result.get("negativeDiagnosisPermitted") is not False):
            raise ValueError("original_CLN_forward_unverified")
        parts=result.get("nativeCandidates")
        if not isinstance(parts,list) or len(parts)!=result.get("candidateCount"):
            raise ValueError("invalid_original_model_candidate_count")
        candidates=[]
        for i,c in enumerate(parts):
            center=c.get("sourceVoxelCentroidIJK");volume=c.get("candidateVolumeMl")
            if (not isinstance(center,list) or len(center)!=3 or
                not all(isinstance(v,(int,float)) and np.isfinite(v) for v in center) or
                not 0<=center[0]<512 or not 0<=center[1]<512 or not 0<=center[2]<103 or
                not isinstance(volume,(int,float)) or not np.isfinite(volume) or volume<=0):
                raise ValueError("CLN_invalid_native_candidate")
            candidates.append({"componentId":i+1,"sourceVoxelCentroidIJK":[round(v,4) for v in center],
                               "candidateVolumeMl":round(volume,6)})
        safe={"schema":"opus-original-cln-TCIA-LCTSC-http-forward/v1",
              "originalScannerDicom":True,"exactOriginalDICOMSeriesSopBindingVerified":True,
              "originalDICOMSourceChainSha256":CHAIN,
              "sourceNativeSha256":source["sha256"],
              "originalCheckpointSHA256":EXPECTED_MODEL,
              "realOriginalModelForwardCompleted":True,"authenticatedLocalHttpWorker":True,
              "candidateCount":len(candidates),"candidates":candidates,
              "positiveDiagnosisSupported":False,"negativeDiagnosisPermitted":False,
              "clinicalValidation":False,"independentExpertReferenceAvailable":False,
              "originalPixelDataSentToCloud":False}
        numeric.write_text(json.dumps(safe,indent=2)+"\n")
        print("REAL ORIGINAL TCIA DICOM CLN COMPLETE",json.dumps({
            "originalScannerDicom":True,"sourceSOPs":103,"originalForward":True,
            "candidateCount":len(candidates),"clinicalValidation":False}),flush=True)
    finally:
        if job:
            try:session.delete(BASE+"/jobs/"+job,headers=headers,timeout=5)
            except Exception:pass
        if process:
            process.terminate()
            try:process.wait(timeout=10)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=10)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("reference","work","numeric","local-map"):
        p.add_argument("--"+name,type=Path,required=True)
    args=p.parse_args()
    run(args.reference,args.work,args.numeric,args.local_map)
