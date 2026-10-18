#!/usr/bin/env python3
"""Source-bound REAL MONAI 0.6.9 RetinaNet lung nodule research inference.

Input: an original, legally authorized Opus-exported HU NIfTI CT (.nii).
Output: source SHA-bound numeric candidate JSON for the /viewer browser.
No patient mode; no automatic checkpoint downloads, GitHub Actions data upload,
Mac M1/8GB execution, or claims of clinical performance.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import shutil
import signal
import struct
import subprocess
import sys
import time

MODEL_SHA="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01"
MODEL_VERSION="0.6.9"
MODEL_REPO_REV="7226a40a4c3713f7d5469559b7f2fc296fd54825"
AUTH="PUBLIC-CHEST-CT-NODULE-RESEARCH-OK"
MAX_INPUT=352+512*512*300*4
MIN_RAM=9*1024**3
MAX_RSS=10*1024**3
MAX_TIME=3300

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as file:
        for chunk in iter(lambda:file.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def original_nifti(path):
    """No volume allocation or model import; preserve original on-disk scalar order."""
    p=Path(path)
    if (p.is_symlink() or not p.is_file() or p.suffix!=".nii" or
            not 352+8*8*8*2<=p.stat().st_size<=MAX_INPUT):
        raise ValueError("bounded_uncompressed_ct_nifti_required")
    with p.open("rb") as source:
        head=source.read(352)
    if (struct.unpack_from("<i",head,0)[0]!=348 or head[344:348]!=b"n+1\x00" or
            struct.unpack_from("<h",head,40)[0]!=3 or
            any(struct.unpack_from("<h",head,k)[0]!=1 for k in (48,50,52,54))):
        raise ValueError("invalid_nifti_3d_header")
    dims=struct.unpack_from("<3h",head,42)
    if any(d<8 or d>limit for d,limit in zip(dims,(512,512,300))):
        raise ValueError("unsupported_ct_dimensions")
    datatype,bitpix=struct.unpack_from("<hh",head,70)
    if (datatype,bitpix) not in ((4,16),(16,32)):
        raise ValueError("unsupported_ct_scalar_encoding")
    bpp=bitpix//8
    if (p.stat().st_size!=352+math.prod(dims)*bpp or
            struct.unpack_from("<f",head,108)[0]!=352.0 or
            head[123]&7!=2 or
            struct.unpack_from("<h",head,252)[0]!=0 or
            struct.unpack_from("<h",head,254)[0] not in (1,2)):
        raise ValueError("invalid_original_ct_nifti_geometry_or_length")
    slope,inter=struct.unpack_from("<ff",head,112)
    if not (slope==0 or math.isnan(slope) or
            (slope==1 and (inter==0 or math.isnan(inter)))):
        raise ValueError("unapplied_hu_rescale_not_allowed")
    ras=[struct.unpack_from("<4f",head,280+row*16) for row in range(3)]
    lps=[[(-1 if row<2 else 1)*value for value in values] for row,values in enumerate(ras)]
    if not all(math.isfinite(v) for line in lps for v in line):
        raise ValueError("invalid_source_world_affine")
    import numpy as np
    basis=np.array([row[:3] for row in lps],dtype=np.float64)
    spacing=np.linalg.norm(basis,axis=0)
    direction=basis/spacing
    if (np.any(spacing<0.1) or np.any(spacing>20) or
            np.max(abs(direction.T@direction-np.eye(3)))>1e-4 or
            abs(np.linalg.det(direction))<0.999):
        raise ValueError("nonorthogonal_or_invalid_source_affine")
    dtype="<f4" if datatype==16 else "<i2"
    native=np.memmap(p,dtype=dtype,mode="r",offset=352,shape=(math.prod(dims),))
    for start in range(0,len(native),1024*1024):
        block=native[start:start+1024*1024]
        if datatype==16 and not np.all(np.isfinite(block)):
            raise ValueError("nonfinite_ct_hu")
    del native
    return {"dimensions":list(dims),"affineLps":[float(x) for line in lps for x in line],
            "spacing":[float(x) for x in spacing],"direction":direction.tolist(),
            "datatype":datatype,"elementType":"MET_FLOAT" if datatype==16 else "MET_SHORT",
            "sourceSha256":digest(p),"sourceBytes":p.stat().st_size}

def source_admission(admission,source):
    path=Path(admission)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>4096:
        raise ValueError("invalid_public_research_attestation")
    manifest=json.loads(path.read_text())
    if (not isinstance(manifest,dict) or manifest.get("schema")!="opus-public-chest-nodule-admission/v1" or
        manifest.get("sourceNiftiSha256")!=source["sourceSha256"] or
        manifest.get("modality")!="CT" or manifest.get("anatomy")!="CHEST" or
        manifest.get("intensity")!="original-HU" or
        manifest.get("publicOrRightsClearedData") is not True or
        manifest.get("containsPatientData") is not False or
        manifest.get("fullSelectedSeriesPresent") is not True):
        raise ValueError("source_rights_intensity_or_scope_unverified")
    return manifest

def prepare_monai_source(path,source,work):
    """Convert EXACT on-disk voxels to ITK MetaImage with DICOM LPS affine.
    Does not alter CT orientation, indices, HU, quantization or spacing.
    """
    dims=source["dimensions"]; d=source["direction"]
    name="source"
    header=[
        "ObjectType = Image","NDims = 3","BinaryData = True",
        "BinaryDataByteOrderMSB = False","CompressedData = False",
        "TransformMatrix = "+" ".join(f"{d[i][j]:.12g}" for i in range(3) for j in range(3)),
        "Offset = "+" ".join(f"{source['affineLps'][i*4+3]:.12g}" for i in range(3)),
        "CenterOfRotation = 0 0 0","AnatomicalOrientation = LPS",
        "ElementSpacing = "+" ".join(f"{n:.12g}" for n in source["spacing"]),
        "DimSize = "+" ".join(map(str,dims)),
        "ElementType = "+source["elementType"],"ElementDataFile = "+name+".raw",
    ]
    with (work/(name+".mhd")).open("x",encoding="ascii") as out:
        out.write("\n".join(header)+"\n")
    with Path(path).open("rb") as inp, (work/(name+".raw")).open("xb") as out:
        inp.seek(352)
        shutil.copyfileobj(inp,out,1024*1024)
    if (work/(name+".raw")).stat().st_size!=source["sourceBytes"]-352:
        raise ValueError("truncated_converted_source")
    return (work/(name+".mhd")).resolve()

def world_to_voxel(source,center):
    import numpy as np
    if len(center)!=3 or any(not math.isfinite(x) for x in center):
        raise ValueError("invalid_model_world_coordinate")
    a=np.array(source["affineLps"],dtype=np.float64).reshape(3,4)
    point=np.linalg.solve(a[:,:3],np.array(center,dtype=np.float64)-a[:,3])
    if not np.all(np.isfinite(point)):
        raise ValueError("invalid_candidate_projection")
    if np.any(point < -0.5) or np.any(point > np.array(source["dimensions"])-0.5):
        return None
    return [round(float(v),5) for v in point]

def parse_candidates(raw_json,source):
    path=Path(raw_json)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>4*1024*1024:
        raise ValueError("invalid_model_prediction_file")
    results=json.loads(path.read_text())
    if not isinstance(results,list) or len(results)!=1:
        raise ValueError("expected_one_full_ct_prediction")
    prediction=results[0]
    if not isinstance(prediction,dict) or not all(k in prediction for k in ("box","label","label_scores")):
        raise ValueError("invalid_pretrained_output")
    boxes,labels,scores=(prediction[k] for k in ("box","label","label_scores"))
    if not all(isinstance(v,list) for v in (boxes,labels,scores)) or
            len(boxes)!=len(labels) or len(boxes)!=len(scores) or len(boxes)>300):
        raise ValueError("invalid_model_candidate_count")
    candidates=[]
    for index,(box,label,score) in enumerate(zip(boxes,labels,scores)):
        if (not isinstance(box,list) or len(box)!=6 or
                not all(type(n) in (int,float) and math.isfinite(n) for n in box) or
                any(d<=0 or d>100 for d in box[3:]) or
                type(label) is not int or label not in (0,1) or
                type(score) not in (int,float) or not math.isfinite(score) or not 0<=score<=1):
            raise ValueError("invalid_model_candidate_values")
        projected=world_to_voxel(source,box[:3])
        candidates.append({
          "index":index,"score":round(float(score),6),
          "centerLpsMm":[round(float(v),5) for v in box[:3]],
          "extentModelMm":[round(float(v),5) for v in box[3:]],
          "nativeVoxelIndexHypothesis":projected,
          "sourceCoordinateFrameIndependentlyVerified":False,
          "clinicalFindingConfirmed":False})
    return candidates

def run(source_path,admission_path,bundle_path,work_path,output_path,authorization):
    if authorization!=AUTH:raise ValueError("explicit_public_chest_ct_research_authorization_required")
    if platform.system()!="Linux":raise ValueError("dedicated_linux_cpu_required_not_m1")
    import psutil
    if psutil.virtual_memory().available<MIN_RAM:raise ValueError("insufficient_linux_cpu_ram")
    if importlib.metadata.version("monai")!="1.4.0" or importlib.metadata.version("torch").split("+")[0]!="2.4.0":
        raise ValueError("pinned_monai_torch_versions_required")
    import torch
    if torch.cuda.is_available():raise ValueError("cpu_only_no_uncontrolled_gpu")
    source=original_nifti(source_path)
    source_admission(admission_path,source)
    bundle=Path(bundle_path).resolve()
    if bundle.is_symlink() or not bundle.is_dir() or not (bundle/"scripts/detection_inferer.py").is_file():
        raise ValueError("official_bundle_must_be_preinstalled_offline")
    weights=bundle/"models/model.pt"
    if weights.is_symlink() or not weights.is_file() or digest(weights)!=MODEL_SHA:
        raise ValueError("wrong_or_missing_monai_checkpoint")
    meta=json.loads((bundle/"configs/metadata.json").read_text())
    if (meta.get("version")!=MODEL_VERSION or
         meta.get("intended_use")!="This is an example, not to be used for diagnostic purposes"):
        raise ValueError("unexpected_bundle_provenance_or_intended_use")
    config=json.loads((bundle/"configs/inference.json").read_text())
    if (config.get("num_classes")!=1 or config.get("infer_patch_size")!=[512,512,192] or
            config["postprocessing"]["transforms"][1].get("_target_")!="AffineBoxToWorldCoordinated" or
            config["postprocessing"]["transforms"][1].get("affine_lps_to_ras") is not True or
            config["preprocessing"]["transforms"][1].get("affine_lps_to_ras") is not True):
        raise ValueError("upstream_world_coordinates_changed")
    work=Path(work_path).resolve();output=Path(output_path).resolve()
    if (work.exists() or output.exists() or not work.parent.is_dir() or
            not output.parent.is_dir() or work==output or
            bundle==work or work.is_relative_to(bundle) or bundle.is_relative_to(work)):
        raise ValueError("new_separate_work_and_report_paths_required")
    work.mkdir(mode=0o700)
    try:
        mhd=prepare_monai_source(source_path,source,work)
        config.update({
          "whether_raw_luna16":True,
          "data_list_file_path":str((work/"one-study.json").resolve()),
          "dataset_dir":str(work),
          "output_dir":str((work/"model-output").resolve()),
          "output_filename":"result.json",
          "device":"$torch.device('cpu')","amp":False,
          "infer_patch_size":[192,192,80],"force_sliding_window":True,
        })
        config["dataloader"]["num_workers"]=0
        if config["checkpointloader"].get("_target_")!="CheckpointLoader":
            raise ValueError("checkpoint_loader_changed")
        config["checkpointloader"]["map_location"]="$torch.device('cpu')"
        (work/"one-study.json").write_text(json.dumps({"validation":[{"image":str(mhd)}]}))
        (work/"model-output").mkdir()
        local_config=work/"monai-source-inference.json"
        local_config.write_text(json.dumps(config))
        environment={k:v for k,v in os.environ.items() if k in ("PATH","HOME","TMPDIR","LANG","LC_ALL")}
        environment.update({"HF_HUB_OFFLINE":"1","HF_HUB_DISABLE_TELEMETRY":"1",
                            "PYTHONDONTWRITEBYTECODE":"1","OMP_NUM_THREADS":"2",
                            "MKL_NUM_THREADS":"2","TORCH_FORCE_WEIGHTS_ONLY_LOAD":"1"})
        start=time.monotonic()
        proc=subprocess.Popen([sys.executable,"-m","monai.bundle","run",
              "--config_file",str(local_config)],cwd=bundle,env=environment,
              stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        peak=0
        try:
            while proc.poll() is None:
                try:
                    root=psutil.Process(proc.pid)
                    rss=sum(p.memory_info().rss for p in [root,*root.children(recursive=True)])
                except psutil.NoSuchProcess:
                    rss=0
                peak=max(peak,rss)
                if (rss>MAX_RSS or psutil.virtual_memory().available<1024**3 or
                        time.monotonic()-start>MAX_TIME):
                    raise RuntimeError("monai_cpu_memory_or_time_guard")
                time.sleep(2)
            if proc.returncode!=0:raise RuntimeError("monai_real_pretrained_inference_failed")
        except BaseException:
            os.killpg(proc.pid,signal.SIGKILL)
            proc.wait(timeout=10)
            raise
        candidates=parse_candidates(work/"model-output/result.json",source)
        report={
          "schema":"opus-monai-bound-nodule-inference/v1",
          "source":{"format":"NIfTI-1-uncompressed","modality":"CT","anatomy":"CHEST",
                    "sha256":source["sourceSha256"],"dimensions":source["dimensions"],
                    "affineLps":source["affineLps"],"headerVerified":True,
                    "operatorVerifiedFullSelectedSeries":True,
                    "sourceDICOMIdentityIndependentlyVerified":False},
          "model":{"id":"monai-lung-nodule-ct-retinanet","version":MODEL_VERSION,
                   "weightsSha256":MODEL_SHA,"bundleRevision":MODEL_REPO_REV,
                   "pretrainedCheckpointReadFromVerifiedBundle":True},
          "execution":{"type":"isolated-linux-cpu-research","actualPretrainedInferenceCompleted":True,
                       "modelCalledOnThisExactSource":True,"seconds":round(time.monotonic()-start,3),
                       "peakProcessRssBytes":peak,"cpuPatch":[192,192,80],
                       "upstreamEvaluationPatchModified":True},
          "candidates":candidates,"clinicalStatus":"unverified_research_draft",
          "sourceWorldCoordinateFrameIndependentlyVerified":False,
          "clinicallyValidated":False,"negativeDiagnosisAllowed":False,
          "limitations":["Original input NIfTI is source-SHA bound; no automatic DICOM SOP binding.",
                         "Model-reported world coordinates remain a research projection pending physician source-image verification.",
                         "The CPU sliding-window patch differs from published upstream evaluation.",
                         "No independent lesion-level FROC/sensitivity/specificity or external negative CT benchmark.",
                         "No candidate never implies a normal study."]
        }
        output.write_text(json.dumps(report,indent=2,ensure_ascii=False))
        return report
    finally:
        shutil.rmtree(work,ignore_errors=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("source","admission","bundle","work","output","authorization"):
        p.add_argument("--"+name,required=True)
    args=p.parse_args()
    report=run(args.source,args.admission,args.bundle,args.work,args.output,args.authorization)
    print(json.dumps({"schema":report["schema"],"candidateCount":len(report["candidates"]),
                      "report":args.output,"clinicalValidation":False}))
if __name__=="__main__":
    main()
