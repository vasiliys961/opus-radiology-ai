#!/usr/bin/env python3
"""REAL trained MONAI 0.6.9 nodule inference on ONE permitted public LUNA16 CT.

Run ONLY on approved isolated Linux GPU worker; never on M1 or patient data.
The official MONAI inference.json and its original preprocessing/postprocessing
are used. We do not implement/retrain an imitation detector.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time

# Model runner and source selector intentionally share only pinned dataset revision.
# Do not import a filename with hyphens as a Python module.
REV="af8fdf04c27dcaa97ccfd755043d8096299d6a40"
def sha256(file):
    h=hashlib.sha256()
    with Path(file).open("rb") as source:
        for part in iter(lambda:source.read(1024*1024),b""):
            h.update(part)
    return h.hexdigest()

MODEL_REPO="MONAI/lung_nodule_ct_detection"
MODEL_REV="7226a40a4c3713f7d5469559b7f2fc296fd54825"
MODEL_SHA="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01"
MAX_CANDIDATES=300
GPU_MIN_MEMORY=15*1024**3

def verify_gpu():
    import torch
    import monai
    if not torch.cuda.is_available():
        raise ValueError("approved_cuda_gpu_required")
    if torch.__version__.split("+")[0]!="2.4.0" or monai.__version__!="1.4.0":
        raise ValueError("pinned_monai_torch_versions_required")
    props=torch.cuda.get_device_properties(0)
    if props.total_memory<GPU_MIN_MEMORY:
        raise ValueError("gpu_vram_below_15_gib")
    return {"cudaName":props.name,"vramTotalBytes":props.total_memory,
            "monaiVersion":monai.__version__,"torchVersion":torch.__version__}

def path_pair(case_dir):
    manifest=json.loads((case_dir/"verified-case.json").read_text())
    if (manifest.get("schema")!="opus-monai-public-gpu-case/v1" or
        manifest.get("datasetRevision")!=REV or
        manifest.get("downloadVerified") is not True or
        len(manifest.get("files",[]))!=2):
        raise ValueError("invalid_public_case_manifest")
    paired={}
    for item in manifest["files"]:
        p=Path(item["relativePath"])
        if (p.is_absolute() or len(p.parts)!=2 or p.parts[0]!="subset0" or
            p.suffix not in (".mhd",".raw") or not re.fullmatch(r"[0-9.]+",p.stem)):
            raise ValueError("invalid_public_case_path")
        file=(case_dir/p).resolve()
        if not file.is_relative_to(case_dir.resolve()) or not file.is_file():
            raise ValueError("missing_public_source")
        if (file.stat().st_size!=item["sizeBytes"] or
                sha256(file)!=item.get("actualSha256")):
            raise ValueError("public_ct_source_sha_changed")
        paired[p.suffix]=file
    if len(paired)!=2 or paired[".mhd"].stem!=paired[".raw"].stem:
        raise ValueError("unpaired_public_ct")
    return manifest,paired

def read_monai_boxes(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size>4*1024*1024:
        raise ValueError("invalid_monai_prediction_file")
    data=json.loads(path.read_text())
    if not isinstance(data,list) or len(data)!=1:
        raise ValueError("not_one_full_volume_prediction")
    record=data[0]
    if not isinstance(record,dict) or set(("box","label","label_scores"))-record.keys():
        raise ValueError("invalid_monai_prediction_schema")
    boxes,labels,scores=(record[key] for key in ("box","label","label_scores"))
    if not all(isinstance(x,list) for x in (boxes,labels,scores)) or (
            len(boxes)!=len(labels) or len(boxes)!=len(scores) or len(boxes)>MAX_CANDIDATES):
        raise ValueError("invalid_prediction_lengths")
    results=[]
    for i,(box,label,score) in enumerate(zip(boxes,labels,scores)):
        if (not isinstance(box,list) or len(box)!=6 or
            not all(type(v) in (int,float) and math.isfinite(v) for v in box) or
            any(v<=0 or v>1000 for v in box[3:]) or
            type(score) not in (int,float) or not math.isfinite(score) or
            not 0<=score<=1 or type(label) is not int or label!=0 and label!=1):
            raise ValueError("invalid_model_candidate")
        results.append({
            "candidateIndex":i,
            "centerMonaiWorldMm":[round(float(x),5) for x in box[:3]],
            "extentMm":[round(float(x),5) for x in box[3:]],
            "rawClassificationScore":round(float(score),6),
            "modelLabel":label,
            "coordinateFrameVerifiedAgainstSource":False,
            "clinicalFindingConfirmed":False,
        })
    return results

def run(case_dir,work,confirmed):
    if confirmed!="PUBLIC-LUNA16-GPU-OK":
        raise ValueError("explicit_external_gpu_consent_required")
    gpu=verify_gpu() # PRE-FLIGHT before touching checkpoint or processing any CT
    from huggingface_hub import snapshot_download
    manifest,paired=path_pair(case_dir)
    out=work.resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError("work_directory_not_empty")
    out.mkdir(parents=True,mode=0o700,exist_ok=True)
    bundle=out/"bundle"
    snapshot_download(repo_id=MODEL_REPO,revision=MODEL_REV,local_dir=str(bundle),
        allow_patterns=["configs/inference.json","configs/metadata.json",
                        "scripts/*.py","models/model.pt","LICENSE"])
    checkpoint=bundle/"models/model.pt"
    if not checkpoint.is_file() or sha256(checkpoint)!=MODEL_SHA:
        raise ValueError("pretrained_monai_checkpoint_hash_mismatch")
    meta=json.loads((bundle/"configs/metadata.json").read_text())
    if meta.get("version")!="0.6.9" or meta.get("intended_use")!="This is an example, not to be used for diagnostic purposes":
        raise ValueError("unexpected_model_intended_use")
    config=json.loads((bundle/"configs/inference.json").read_text())
    if (config.get("num_classes")!=1 or config.get("infer_patch_size")!=[512,512,192] or
        config.get("device")!="$torch.device('cuda:0' if torch.cuda.is_available() else 'cpu')" or
        config.get("postprocessing",{}).get("transforms",[])[1].get("_target_")!="AffineBoxToWorldCoordinated"):
        raise ValueError("model_transform_contract_changed")
    config["whether_raw_luna16"]=True
    config["data_list_file_path"]=str((out/"single-public-case.json").resolve())
    config["dataset_dir"]=str(paired[".mhd"].parent)
    config["output_dir"]=str((out/"prediction").resolve())
    config["output_filename"]="monai-raw-output.json"
    config["dataloader"]["num_workers"]=0
    config["amp"]=True
    (out/"prediction").mkdir()
    (out/"single-public-case.json").write_text(json.dumps(
        {"validation":[{"image":paired[".mhd"].name}]}))
    configfile=bundle/"configs/opus-one-luna-inference.json"
    configfile.write_text(json.dumps(config,indent=2))
    before=time.monotonic()
    # Child process loads real pretrained checkpoint via pinned MONAI loader.
    # HF offline reduces accidental downloads; actual network isolation must be
    # supplied by the owner's dedicated sandbox/runner policy.
    env={**os.environ,"HF_HUB_OFFLINE":"1","HF_HUB_DISABLE_TELEMETRY":"1",
         "PYTHONDONTWRITEBYTECODE":"1","OMP_NUM_THREADS":"2"}
    subprocess.run([sys.executable,"-m","monai.bundle","run",
                    "--config_file",str(configfile)],cwd=bundle,env=env,
                   check=True,timeout=1800)
    seconds=round(time.monotonic()-before,3)
    output=out/"prediction/monai-raw-output.json"
    results=read_monai_boxes(output)
    report={
        "schema":"opus-monai-luna16-real-single-ct-inference/v1",
        "status":"genuine_trained_checkpoint_executed_on_public_ct",
        "publicStudy":{"sourceSeriesIdSha256":manifest["sourceSeriesIdSha256"],
                       "sourceMhdSha256":next(i["actualSha256"] for i in manifest["files"] if i["relativePath"].endswith(".mhd")),
                       "sourceRawSha256":next(i["actualSha256"] for i in manifest["files"] if i["relativePath"].endswith(".raw")),
                       "dimensions":manifest["sourceGeometry"]["dimensions"],
                       "luna16GroundTruthNoduleCount":manifest["positiveExpertReferenceNodules"]},
        "model":{"id":"monai-lung-nodule-ct-retinanet","version":"0.6.9",
                 "weightsSha256":MODEL_SHA,"revision":MODEL_REV,
                 "modelCheckpointActualSha256Verified":True},
        "runtime":{"execution":"approved-external-gpu","elapsedSeconds":seconds,"gpu":gpu},
        "coverage":{"sourceFullCtProcessed":True,"onlyOnePublicStudy":True,
                    "sourceWorldCoordinateVerification":"not_yet_completed",
                    "negativeDiagnosticConclusionAllowed":False},
        "candidates":results,"candidateCount":len(results),
        "metrics":{"sensitivity":None,"specificity":None,"froc":None,
                   "falsePositivesPerScan":None,"independentValidation":False},
        "readyForClinicalUse":False,
    }
    final=out/"public-nodule-inference.json"
    final.write_text(json.dumps(report,indent=2,ensure_ascii=False))
    # Printed public case model candidate coordinates are not clinical findings
    # and have not yet been registered onto the original MPR grid.
    print(json.dumps(report,ensure_ascii=False))
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--case-dir",required=True,type=Path)
    p.add_argument("--work",required=True,type=Path)
    p.add_argument("--external-gpu-confirm",required=True)
    a=p.parse_args()
    run(a.case_dir,a.work,a.external_gpu_confirm)
if __name__=="__main__":main()
