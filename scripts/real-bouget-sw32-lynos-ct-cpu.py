#!/usr/bin/env python3
"""ONE genuine publisher Bouget CPU forward on public LyNoS Pat3 CT.

Uses author's original 1.05GB weights, verified MD5+SHA256, plus an exact
public LyNoS CT SHA256. Inference exclusively Docker CPU/no-network, RAM cap.
No patient uploads, no images in artifacts; no diagnosis or model calibration.
"""
from __future__ import annotations
import argparse
import configparser
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import zipfile

PINNED_IMAGE_SHA256 = "d918d73688c38be7550a59e881e6a72b617f4d8f4171e99b286afb89f27ce646"
PINNED_PUBLISHER_ZIP_SHA256 = "e00d3c83aed6ba7fc0cd376e20e4aa3ec8a672d1737a0fc41becc8d217449d72"
DOCKER_IMAGE = "dbouget/ct_mediastinal_structures_segmentation:v1"
HF_DATASET = "andreped/LyNoS"
CT_FILE = "Pat3/pat3_data.nii.gz"
GT_FILE = "Pat3/pat3_labels_LymphNodes.nii.gz"
MAX_STORAGE_BYTES = 4 * 1024**3
PREDICTION_THRESHOLD = 0.4  # Explicit research threshold, not calibrated

def loaded_preflight():
    mod_path = Path(__file__).with_name("bouget-official-checkpoint-preflight.py")
    spec = importlib.util.spec_from_file_location("official_bouget_gate", mod_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def guarded_copy_member(archive,info,target:Path,limit:int):
    if info.file_size > limit:
        raise ValueError("oversized_original_model_member")
    target.parent.mkdir(parents=True,exist_ok=True)
    with archive.open(info) as src,target.open("xb") as out:
        copied=0
        while data:=src.read(1024*1024):
            copied+=len(data)
            if copied>limit:
                raise ValueError("original_model_member_stream_overflow")
            out.write(data)
    if copied!=info.file_size:
        raise ValueError("model_truncated_during_extraction")

def select_lymphnode_prediction(output_dir:Path, model_config:Path, prefix:str):
    """Select only a publisher-declared lymph-node probability channel.

    The original model emits multiple files (including its prerequisite CT_Lungs).
    A glob selecting the first or requiring exactly one file is unsafe.
    The class label must come from the genuine model pre_processing.ini,
    with the exact publisher filename convention in src/Utils/io.py.
    """
    config = configparser.ConfigParser()
    if not config.read(model_config):
        raise ValueError("original_UNet_SW32_training_class_config_missing")
    raw = config.get("Training", "classes", fallback="").split("#", 1)[0]
    declared = [label.strip() for label in raw.split(",") if label.strip()]
    matches = [label for label in declared
               if re.sub(r"[^a-z0-9]", "", label.lower()) in
               {"lymphnode", "lymphnodes", "mediastinallymphnodes"}]
    if len(matches) != 1:
        raise ValueError("original_model_lymphnode_class_not_uniquely_declared")
    label = matches[0]
    candidate = output_dir / (prefix + "-pred_" + label + ".nii.gz")
    if not candidate.is_file() or candidate.stat().st_size == 0:
        raise ValueError("original_lymphnode_probability_output_missing")
    return label, candidate


def metrics(pred_path:Path,expert_path:Path):
    import nibabel as nib
    import numpy as np
    reference=nib.load(str(expert_path))
    prediction=nib.load(str(pred_path))
    if reference.shape!=prediction.shape or len(reference.shape)!=3 or not np.allclose(reference.affine,prediction.affine,rtol=0,atol=0.03):
        raise ValueError("model_predictions_not_in_native_expert_CT_geometry")
    ref=np.asarray(reference.dataobj)>0
    scores=np.asarray(prediction.dataobj)
    if not np.isfinite(scores).all() or scores.min() < 0 or scores.max() > 1:
        raise ValueError("original_prediction_is_not_valid_probability_volume")
    pred=scores>=PREDICTION_THRESHOLD
    tp=int(np.count_nonzero(ref&pred));fp=int(np.count_nonzero(~ref&pred));fn=int(np.count_nonzero(ref&~pred))
    denominator=2*tp+fp+fn
    return {"maskGeometryExact":True,"referencePositiveVoxels":int(np.count_nonzero(ref)),
            "predictedVoxels":int(np.count_nonzero(pred)),"TP":tp,"FP":fp,"FN":fn,
            "voxelDice":(2*tp/denominator if denominator else None),
            "notIndependentHoldout":True,"caseCount":1,"lesionRecallValidated":False,
            "wholeCTOriginalModelForwardCompleted":True,"clinicallyValidated":False}

def run_case(work:Path):
    work.mkdir(parents=True,exist_ok=True)
    source=work/"original-models.zip"
    mod=loaded_preflight()
    mod.download_publisher_archive(source)
    manifest=mod.evaluate_checkpoint_archive(source)
    if manifest["archiveSHA256"]!=PINNED_PUBLISHER_ZIP_SHA256:
        raise ValueError("publisher_weights_differ_from_verified_sha256")
    root=work/"resources"
    models=root/"models"
    with zipfile.ZipFile(source) as zipf:
        selected=[]
        for info in zipf.infolist():
            parts=PurePosixPath(info.filename).parts
            if ("UNet-SW32" in parts or "CT_Lungs" in parts) and not info.is_dir():
                if ".." in parts or PurePosixPath(info.filename).is_absolute():
                    raise ValueError("invalid_checkpoint_member")
                model_dir="UNet-SW32" if "UNet-SW32" in parts else "CT_Lungs"
                idx=parts.index(model_dir)
                relative=Path(*parts[idx:])
                if len(relative.parts)>4:
                    raise ValueError("checkpoint_excessive_depth")
                selected.append((info,relative))
        for model_name in ("UNet-SW32","CT_Lungs"):
            match=[name for _,name in selected if name.parts[0]==model_name]
            if not any(name.name.endswith((".h5",".hdf5",".hdf",".hd5",".ckpt")) for name in match):
                raise ValueError("required_publisher_"+model_name+"_checkpoint_missing")
            if not any(name.name=="pre_processing.ini" for name in match):
                raise ValueError("required_publisher_"+model_name+"_preprocessing_missing")
        for info,name in selected:
            guarded_copy_member(zipf,info,models/name,2*1024**3)
    from huggingface_hub import hf_hub_download
    for name in (CT_FILE,GT_FILE):
        hf_path=Path(hf_hub_download(repo_id=HF_DATASET,repo_type="dataset",filename=name))
        if hf_path.stat().st_size>MAX_STORAGE_BYTES:raise ValueError("oversized_public_reference_CT")
        destination=root/"data"/Path(name).name
        destination.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(hf_path,destination)
    ct_path=root/"data"/Path(CT_FILE).name
    if mod.digest_file(ct_path,"sha256")!=PINNED_IMAGE_SHA256:
        raise ValueError("public_LyNoS_CT_SHA256_mismatch")
    (root/"data"/"runtime_config.ini").write_text(
        "[Predictions]\nnon_overlapping=true\nreconstruction_method=probabilities\n"
        "reconstruction_order=resample_first\nprobability_threshold=0.4\n")
    (root/"output").mkdir(exist_ok=True)
    # This directory alone must be writable by the publisher container's
    # unprivileged UID, which differs from GitHub's host runner UID.
    (root/"output").chmod(0o1777)
    subprocess.run(["docker","pull",DOCKER_IMAGE],check=True,timeout=600)
    # Source volume and original trained models only. No network in Docker.
    command=["docker","run","--rm","--network","none","--memory","5g",
             "--memory-swap","5g","--cpus","2","--pids-limit","128",
             "--security-opt","no-new-privileges","-v",f"{root.resolve()}:/home/ubuntu/resources",
             DOCKER_IMAGE,"-i","./resources/data/"+ct_path.name,
             "-o","./resources/output/lynos-pat3","-m","UNet-SW32"]
    subprocess.run(command,check=True,timeout=1200)
    # Publisher emits CT_Lungs and UNet-SW32 channels in the same output dir.
    # Never score the lung probability as mediastinal lymph nodes.
    declared_class, node_path=select_lymphnode_prediction(
        root/"output",models/"UNet-SW32"/"pre_processing.ini","lynos-pat3")
    original_gt=root/"data"/Path(GT_FILE).name
    report=metrics(node_path,original_gt)
    report.update({
        "schema":"opus-real-bouget-mediastinal-UNet-SW32-LyNoS-P3/v1",
        "originalArchiveSHA256":PINNED_PUBLISHER_ZIP_SHA256,
        "originalPublicCtSHA256":PINNED_IMAGE_SHA256,
        "model":"Bouget-UNet-SW32",
        "publisherOutputClass":declared_class,
        "probabilityThreshold":PREDICTION_THRESHOLD,
        "gpuUsed":False,"cpuMemoryCapGiB":5,
        "patientCloudTransfer":False,
        "sourceType":"research_public_contrast_enhanced_CT",
        "expertGroundTruth":"LyNoS original lymph node reference",
        "clinicalValidation":False})
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--workdir",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    args=p.parse_args()
    try:
        output=run_case(args.workdir)
        args.report.parent.mkdir(parents=True,exist_ok=True)
        args.report.write_text(json.dumps(output,indent=2)+"\n")
        print("PUBLISHER ORIGINAL CPU FORWARD, Native geometry and expert reference passed")
        print(json.dumps({"caseCount":output["caseCount"],"TP":output["TP"],
                          "FP":output["FP"],"FN":output["FN"],"Dice":output["voxelDice"]}))
    except Exception as e:
        print("REAL_POSITIVE_CPU_INFERENCE_NOT_CONFIRMED: "+str(e),file=sys.stderr)
        raise SystemExit(2)

if __name__=="__main__":
    main()
