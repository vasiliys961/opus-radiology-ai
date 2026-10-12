#!/usr/bin/env python3
"""Opt-in bounded real CPU inference on a provisioned Linux host; public CT only."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import time

MODEL_FOLDERS=("Dataset297_TotalSegmentator_total_3mm_1559subj",
               "Dataset298_TotalSegmentator_total_6mm_1559subj")
TRAINER="nnUNetTrainer_4000epochs_NoMirroring__nnUNetPlans__3d_fullres"

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as handle:
        while data:=handle.read(131072):
            h.update(data)
    return h.hexdigest()

def host_memory_bytes(meminfo=Path("/proc/meminfo"), field="MemTotal"):
    for line in meminfo.read_text().splitlines():
        if line.startswith(field + ":"):
            return int(line.split()[1])*1024
    raise ValueError("unknown_host_memory")

def available_memory_bytes():
    return host_memory_bytes(field="MemAvailable")

def prepare(input_file, model_dir, output_dir):
    if Path(input_file).is_symlink() or Path(model_dir).is_symlink() or Path(output_dir).is_symlink():
        raise ValueError("unsafe_symlink")
    source=Path(input_file).resolve(strict=True)
    models=Path(model_dir).resolve(strict=True)
    output=Path(output_dir).resolve(strict=True)
    if not source.is_file() or source.suffix!=".nii" or not models.is_dir() or not output.is_dir():
        raise ValueError("invalid_paths")
    if not os.access(output,os.W_OK):
        raise ValueError("output_not_writable")
    target=output/"totalseg_lobes.nii"
    if target.exists() or target.is_symlink():
        raise ValueError("refuse_to_overwrite_result")
    for folder in MODEL_FOLDERS:
        for name in ("plans.json","dataset.json","fold_0/checkpoint_final.pth"):
            p=models/folder/TRAINER/name
            if not p.is_file() or p.is_symlink() or p.stat().st_size==0:
                raise ValueError("model_cache_incomplete")
    if host_memory_bytes()<14*1024**3:
        raise ValueError("host_requires_at_least_14_gib_ram")
    if available_memory_bytes()<12*1024**3:
        raise ValueError("host_has_less_than_12_gib_available_ram")
    return source,models,output,sha256(source)

def reported_stage(process):
    """Only trust fixed diagnostic stage tokens, never echo exception strings."""
    allowed_mask={"invalid_dimensions","invalid_affine","invalid_source_identity",
                  "invalid_label_set","invalid_mask_file","invalid_mask_header",
                  "mask_geometry_mismatch","truncated_mask","unexpected_mask_label",
                  "oversized_mask","empty_mask_needs_review","unrecognized_validation_error"}
    allowed={"arguments","input_preflight","input_nifti_load","runtime_cache",
             "model_import","model_inference","mask_validation"}
    for line in reversed(process.stderr.splitlines()):
        try:
            data=json.loads(line)
        except (ValueError,TypeError):
            continue
        if isinstance(data,dict) and data.get("status")=="failed" and data.get("stage") in allowed:
            result={"stage":data["stage"],"errorType":data.get("error") if data.get("error") in
                    {"ValueError","OSError","PermissionError","FileNotFoundError",
                     "RuntimeError","ImportError","ModuleNotFoundError","AssertionError",
                     "TypeError","KeyError","IndexError"} else "other"}
            if data["stage"]=="mask_validation" and data.get("maskRejection") in allowed_mask:
                result["maskRejection"]=data["maskRejection"]
            return result
    return {"stage":"unknown","errorType":"unknown"}

def failure_category(process):
    """Never publish raw Docker logs or host paths in CI artifacts."""
    log=(process.stderr+"\n"+process.stdout).lower()
    checks=(
        ("docker_runtime", ("cannot connect to the docker daemon", "error response from daemon",
                            "permission denied while trying to connect to the docker daemon")),
        ("model_missing", ("no such file or directory: '/models", "dataset297_", "dataset298_")),
        ("read_only_filesystem", ("read-only file system", "permissionerror")),
        ("memory", ("out of memory", "cannot allocate memory", "killed")),
        ("python_import", ("modulenotfounderror", "importerror")),
        ("nifti_invalid", ("invalid_nifti", "invalid_input", "invalid_mask")),
        ("weight_download_attempt", ("connectionerror", "network is unreachable", "name or service not known")),
    )
    for category,terms in checks:
        if any(term in log for term in terms):
            return category
    return "unclassified"

def run(input_file,model_dir,output_dir,*,confirmed=False,repo_root=None):
    if not confirmed:
        raise ValueError("explicit_research_confirmation_required")
    source,models,output,identity=prepare(input_file,model_dir,output_dir)
    root=Path(repo_root) if repo_root else Path(__file__).resolve().parents[1]
    compose=root/"deploy/compose.totalseg-research.yaml"
    env=os.environ.copy()
    env.update(OPUS_PUBLIC_CT_NII=str(source),
               OPUS_TOTALSEG_MODEL_HOME=str(models),
               OPUS_RESEARCH_OUTPUT_DIR=str(output))
    cmd=["docker","compose","-f",str(compose),"run","--rm","--build","totalseg-research",
         "--input","/data/input.nii","--output","/output/totalseg_lobes.nii",
         "--research-confirmed","--source-sha256",identity]
    start=time.monotonic()
    process=subprocess.run(cmd,env=env,capture_output=True,text=True,timeout=3600)
    elapsed=time.monotonic()-start
    report={"schema":"opus-totalseg-first-inference/v1",
            "sourceSha256":identity,"elapsedSeconds":round(elapsed,2),
            "exitCode":process.returncode,"clinicalStatus":"not_validated",
            "readyForClinicalUse":False}
    if process.returncode==0:
        try:
            payload=json.loads(process.stdout.strip().splitlines()[-1])
            if payload.get("execution")!="real-model-call" or payload.get("result",{}).get("sourceIdentitySha256")!=identity:
                raise ValueError("invalid_executor_report")
            mask=output/"totalseg_lobes.nii"
            if mask.is_symlink() or not mask.is_file():
                raise ValueError("missing_output_mask")
            report.update(status="completed_unvalidated",maskSha256=sha256(mask),
                          labelVoxels=payload["result"]["labelVoxels"])
        except (ValueError,KeyError,IndexError,TypeError):
            report["status"]="invalid_output"
    else:
        report["status"]="failed"
        report["failureCategory"]=failure_category(process)
        report.update(reported_stage(process))
    # Never echo the Docker logs (potentially contain private local paths).
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",required=True,type=Path)
    p.add_argument("--models",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--research-confirmed",action="store_true")
    a=p.parse_args()
    try:
        result=run(a.input,a.models,a.output,confirmed=a.research_confirmed)
    except (OSError,ValueError,subprocess.TimeoutExpired) as exc:
        print(json.dumps({"status":"failed","error":type(exc).__name__}),file=sys.stderr)
        return 2
    print(json.dumps(result,sort_keys=True))
    return 0 if result["status"]=="completed_unvalidated" else 2

if __name__=="__main__":
    raise SystemExit(main())
