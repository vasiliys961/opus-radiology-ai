#!/usr/bin/env python3
"""Run original CLN nnU-Net weights on ONE pinned public tumor-positive CT via localhost HTTP.

This exercises the worker consumed by the one-click DICOM application, rather than
a separate direct model script. Never records CT pixels, masks, token, or clinical PHI.
The MSD case may have been used in training; this is a FUNCTIONAL test, not external
validation or an established diagnostic diagnosis.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time

EXPECTED_CT_SHA = "08b7aa88ee9946b0bf0a5fcd08af1d9b7720c4295e4f900a3e2f13d5c3b6b694"
EXPECTED_EXPERT_SHA = "cc593eb359bc530642386b8fa1760fc2c2e8c45fe2a8faae62ff321f3dd8d689"
EXPECTED_MODEL_SHA = "8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
EXPECTED_DATASET_REVISION = "8788e7233406875cf5f2366cf27f8f155fb7a8cf"
BASE = "http://127.0.0.1:8783/v1/cln"
SOURCE_MAX = 400 * 1024**2


def load_script(path: Path):
    spec = importlib.util.spec_from_file_location("cln_http_original_reference", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("original_python_module_missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def unzip_public_nii(source: Path, target: Path):
    if target.exists():
        raise ValueError("source_destination_already_exists")
    n = 0
    h = hashlib.sha256()
    with gzip.open(source, "rb") as source_file, target.open("xb") as out:
        while part := source_file.read(1024 * 1024):
            n += len(part)
            if n > SOURCE_MAX:
                raise ValueError("source_CT_uncompressed_budget_exceeded")
            out.write(part)
            h.update(part)
    with target.open("rb") as f:
        header = f.read(352)
    if len(header) != 352 or int.from_bytes(header[:4], "little") != 348 or header[344:348] != bytes([110,43,49,0]):
        raise ValueError("original_NIfTI_header_invalid")
    return h.hexdigest(), n


def preflight():
    import psutil
    memory = psutil.virtual_memory().available
    free = shutil.disk_usage("/tmp").free
    print("PUBLIC CLN HTTP PREFLIGHT", json.dumps({
        "freeRamGiB": round(memory / 2**30, 2),
        "freeDiskGiB": round(free / 2**30, 2),
    }))
    if memory < 12 * 2**30 or free < 6 * 2**30:
        raise RuntimeError("authentic_CLN_worker_requires_12GiB_available_and_6GiB_disk")


def run(root: Path, work: Path, *, derived_native: Path | None = None,
        derived_manifest: Path | None = None):
    import requests

    preflight()
    approved = load_script(root / "scripts/cln-msd-original-positive-public-ct.py")
    model = approved.load_cln()
    public = approved.get_public_case(work / "published")
    if (public["revision"] != EXPECTED_DATASET_REVISION or
            public["ctSHA256"] != EXPECTED_CT_SHA or
            public["expertSHA256"] != EXPECTED_EXPERT_SHA or
            public["expertPositiveVoxels"] != 1912):
        raise RuntimeError("published_CT_or_expert_geometry_differs_from_pinned_positive_case")
    model_root = work / "models"
    manifest = model.provision(model_root / model.TASK / model.TRAINER)
    if (manifest["checkpointSHA256"] != EXPECTED_MODEL_SHA or
            manifest["publisherLfsWeightSHA256Verified"] is not True):
        raise RuntimeError("not_original_author_model_SHA256")
    raw = work / "native-original-source.nii"
    derived_map = None
    if derived_native is not None:
        if derived_manifest is None or not derived_native.is_file():
            raise ValueError("DICOM_native_source_and_manifest_required")
        derived_map=json.loads(derived_manifest.read_text())
        if (derived_map.get("schema") != "opus-public-msd-reencoded-dicom/v1" or
            derived_map.get("scannerOriginalDicom") is not False or
            derived_map.get("sourceNiftiCompressedSha256") != EXPECTED_CT_SHA or
            derived_map.get("derivedSopGeometryVerified") is not True or
            derived_map.get("scannerOriginalSopRegistrationVerified") is not False or
            derived_map.get("sourceIntegerHuLossless") is not True or
            derived_map.get("convertedNativeSha256") != sha256(derived_native) or
            not isinstance(derived_map.get("nativeSopInstanceUids"), list) or
            len(set(derived_map["nativeSopInstanceUids"])) != len(derived_map["nativeSopInstanceUids"])):
            raise ValueError("derived_DICOM_not_source_verified")
        shutil.copyfile(derived_native, raw)
        native_sha, byte_count = sha256(raw), raw.stat().st_size
    else:
        native_sha, byte_count = unzip_public_nii(public["ct"], raw)
    if not (352 < byte_count <= SOURCE_MAX):
        raise RuntimeError("public_CT_not_a_bounded_3D_native_volume")

    token = secrets.token_urlsafe(48)
    env = os.environ.copy()
    env.update({
        "OPUS_CLN_MODEL_ROOT": str(model_root),
        "OPUS_CLN_CHECKPOINT_SHA256": EXPECTED_MODEL_SHA,
        "OPUS_CLN_WORKER_TOKEN": token,
        "OPUS_CLN_WORKER_ORIGIN": "http://127.0.0.1:3000",
        "nnUNet_results": str(model_root),
        "nnUNet_raw": str(work / "nnunet-raw"),
        "nnUNet_preprocessed": str(work / "nnunet-preprocessed"),
        "OMP_NUM_THREADS": "2",
        "MKL_NUM_THREADS": "2",
        "CUDA_VISIBLE_DEVICES": "-1",
    })
    headers = {"Authorization": "Bearer " + token,
               "Origin": "http://127.0.0.1:3000"}
    worker = root / "services/imaging-ai/cln_native_upload_worker.py"
    # Private worker, not exposed publicly. Log stays ephemeral and is never uploaded.
    log_file = work / "worker-local.log"
    process = None
    job_id = None
    try:
        with log_file.open("wb") as log:
            process = subprocess.Popen(
                [sys.executable, str(worker)],
                cwd=str(root), env=env, stdout=log, stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        client = requests.Session()
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("private_original_CLN_worker_exited_before_healthcheck")
            try:
                res = client.get(BASE + "/capabilities", headers=headers, timeout=5)
                if res.ok:
                    cap = res.json()
                    break
            except requests.RequestException:
                pass
            time.sleep(1)
        else:
            raise TimeoutError("original_worker_no_loopback_healthcheck")
        if (cap.get("schema") != "opus-original-cln-upload-worker/v1" or
            cap.get("originalWeightsVerified") is not True or
            cap.get("checkpointSha256") != EXPECTED_MODEL_SHA or
            cap.get("imageUpload") is not True or cap.get("patientMode") is not False):
            raise RuntimeError("original_CLN_healthcheck_denied_unverified_weights")
        unauthorized = client.get(BASE + "/capabilities", headers={"Origin":headers["Origin"]},timeout=10)
        if unauthorized.status_code != 403:
            raise RuntimeError("worker_protected_endpoint_allows_missing_token")
        upload_headers = {
            **headers,
            "Content-Type": "application/octet-stream",
            "X-Opus-Source-Sha256": native_sha,
            "X-Opus-Public-Research-Authorization": "approved-nonpatient-source",
        }
        print("ORIGINAL CLN HTTP: uploading pinned public native CT",json.dumps({
            "uncompressedBytes": byte_count, "sourceSha256": native_sha,
            "checkpointSha256": EXPECTED_MODEL_SHA,
        }), flush=True)
        with raw.open("rb") as f:
            post = client.post(BASE + "/upload",headers=upload_headers,data=f,timeout=150)
        post.raise_for_status()
        start = post.json()
        if start.get("schema") != "opus-cln-job/v1" or start.get("state") != "running":
            raise RuntimeError("private_worker_start_not_admitted")
        job_id = start.get("jobId")
        if not isinstance(job_id,str) or len(job_id) != 36:
            raise RuntimeError("private_worker_did_not_bind_original_source_job")
        deadline = time.monotonic() + 3400
        while time.monotonic() < deadline:
            status = client.get(BASE + "/jobs/" + job_id,headers=headers,timeout=25)
            status.raise_for_status()
            current = status.json()
            if current.get("state") == "failed":
                raise RuntimeError("original_CLN_HTTP_forward_failed_" + str(current.get("reason"))[:100])
            if current.get("state") == "succeeded":
                break
            if current.get("state") != "running":
                raise RuntimeError("unexpected_original_worker_job_state")
            if process.poll() is not None:
                raise RuntimeError("original_worker_died_during_inference")
            time.sleep(7)
        else:
            raise TimeoutError("original_cln_3D_CPU_forward_exceeded_3400_seconds")
        response = client.get(BASE + "/jobs/" + job_id + "/report",headers=headers,timeout=20)
        response.raise_for_status()
        result = response.json()
        if (result.get("schema") != "opus-original-cln-upload-result/v1" or
            result.get("sourceNiftiSha256") != native_sha or
            result.get("checkpointSha256") != EXPECTED_MODEL_SHA or
            result.get("realOriginalModelForwardCompleted") is not True or
            result.get("researchOnly") is not True or
            result.get("clinicalValidation") is not False or
            result.get("negativeDiagnosisPermitted") is not False):
            raise RuntimeError("unverified_or_unbound_original_CLN_HTTP_result")
        components = result.get("nativeCandidates")
        if not isinstance(components,list) or len(components) != result.get("candidateCount"):
            raise RuntimeError("original_worker_mismatched_components")
        if not components:
            raise RuntimeError("original_CLN_did_not_detect_expert_positive_public_lesion")
        originals = []
        for i,component in enumerate(components):
            center=component.get("sourceVoxelCentroidIJK")
            vol=component.get("candidateVolumeMl")
            if not isinstance(center,list) or len(center)!=3 or not all(isinstance(x,(int,float)) for x in center):
                raise RuntimeError("missing_source_voxel_component_center")
            if not isinstance(vol,(int,float)) or not 0 < vol < 10000:
                raise RuntimeError("original_CLN_invalid_positive_candidate_volume")
            originals.append({
                "componentId":i+1,
                "sourceVoxelCentroidIJK":[round(float(x),3) for x in center],
                "candidateVolumeMl":round(vol,6),
            })
        native_center=[148.04,231.323,99.345]
        if derived_map is not None and derived_map.get("sourceZReversed") is True:
            native_center[2]=derived_map["dimensions"][2]-1-native_center[2]
        if not any(
            sum((p-e)**2 for p,e in zip(item["sourceVoxelCentroidIJK"],native_center))**.5 < 25
            for item in originals
        ):
            raise RuntimeError("original_model_no_candidate_near_prior_expert_positive_region")
        numeric={
            "schema":"opus-original-cln-private-http-positive-public-ct/v1",
            "source":"MedOtter/msd-lung lung_043.nii.gz",
            "sourceSha256Compressed":EXPECTED_CT_SHA,
            "sourceSha256UploadedNative":native_sha,
            "publisherCheckpointSHA256":EXPECTED_MODEL_SHA,
            "originalWeightsVerified":True,
            "realOriginalModelForwardCompleted":True,
            "testedViaAuthenticatedLocalHttpWorker":True,
            "workerModelId":"Lab-Rasool/CLN-Segmenter-MSD-fold0",
            "sourceBound":True,
            "candidateCount":len(originals),
            "candidates":originals,
            "expertMaskPositiveVoxels":1912,
            "sourceIsTrainingOrValidationAmbiguous":True,
            "independentValidation":False,
            "originalDicomSopRegistrationVerified":False,
            "derivedDicomSopRegistrationVerified": derived_map is not None,
            "derivedDicomSourceNativeSHA256":native_sha if derived_map is not None else None,
            "clinicalAccuracyValidated":False,
            "negativeDiagnosisPermitted":False,
            "patientCloudTransfer":False,
            "wholeBrowserViewerWorkflowTested":False,
        }
        print("REAL ORIGINAL CLN HTTP WORKER PASS",json.dumps(numeric),flush=True)
        return numeric
    finally:
        if job_id:
            try:
                requests.delete(BASE + "/jobs/" + job_id,headers=headers,timeout=8)
            except Exception:
                pass
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--workdir",type=Path,required=True)
    ap.add_argument("--report",type=Path,required=True)
    ap.add_argument("--derived-native", type=Path)
    ap.add_argument("--derived-manifest", type=Path)
    args=ap.parse_args()
    if (args.derived_native is None) != (args.derived_manifest is None):
        raise SystemExit("derived_DICOM_source_requires_both_files")
    if args.report.exists():
        raise SystemExit("original_report_already_exists")
    args.workdir.mkdir(parents=True,exist_ok=True)
    root=Path(__file__).resolve().parents[1]
    report=run(root,args.workdir,derived_native=args.derived_native,
               derived_manifest=args.derived_manifest)
    args.report.write_text(json.dumps(report,indent=2)+"\n")


if __name__=="__main__":
    main()
