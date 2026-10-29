#!/usr/bin/env python3
"""Original Lab-Rasool CLN nnU-Net v2 lung-tumor CPU research adapter.

"provision" fetches original public checkpoint + metadata without studies.
"infer" requires an explicitly approved, hash-pinned public CT and externally
bounded CPU host; never send patient images or store masks in CI artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time

REPO = "Lab-Rasool/CLN-Segmenter-MSD-fold0"
# Exact publisher commit shown on model's public page at verification.
REVISION = "150ec31"
TASK = "Dataset502_MSDLung"
TRAINER = "nnUNetTrainer__nnUNetPlans__3d_fullres"
FILES = ("checkpoint_best.pth", "nnUNetPlans.json", "dataset.json",
         "dataset_fingerprint.json", "splits_final.json")
MAX_FILE_BYTES = 400 * 1024**2
MAX_CT_BYTES = 1024**3


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as inp:
        for part in iter(lambda: inp.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def check_publisher_metadata(dataset: dict, plans: dict) -> None:
    if not isinstance(dataset, dict) or not isinstance(plans, dict):
        raise ValueError("invalid_author_published_config")
    labels = dataset.get("labels")
    if (not isinstance(labels, dict) or "background" not in labels or
            labels["background"] != 0 or 1 not in labels.values() or
            dataset.get("file_ending") != ".nii.gz"):
        raise ValueError("publisher_CT_tumor_label_1_not_verified")
    if not plans.get("configurations") or "3d_fullres" not in plans["configurations"]:
        raise ValueError("publisher_3d_fullres_plan_missing")


def provision(destination: Path) -> dict:
    from huggingface_hub import hf_hub_download, model_info
    info = model_info(REPO, revision=REVISION, files_metadata=True, token=False)
    if not info.sha.startswith(REVISION):
        raise ValueError("publisher_revision_mismatch")
    entries = {s.rfilename: s for s in info.siblings}
    if any(name not in entries for name in FILES):
        raise ValueError("required_original_publisher_files_missing")
    remote_digest = getattr(entries["checkpoint_best.pth"], "lfs", None)
    if not remote_digest or not remote_digest.get("sha256"):
        raise ValueError("no_official_checkpoint_LFS_SHA256")
    files = {}
    destination.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        remote_size = entries[name].size
        if remote_size is not None and (remote_size <= 0 or remote_size > MAX_FILE_BYTES):
            raise ValueError("unbounded_original_publisher_asset")
        downloaded = Path(hf_hub_download(REPO, filename=name, revision=info.sha,
                                          token=False))
        if not downloaded.is_file() or downloaded.stat().st_size > MAX_FILE_BYTES:
            raise ValueError("original_checkpoint_download_failed_or_oversized")
        actual_hash = sha256(downloaded)
        if name == "checkpoint_best.pth" and actual_hash != remote_digest["sha256"]:
            raise ValueError("original_weights_do_not_match_publisher_LFS_SHA256")
        # The publisher's nnU-Net directory uses 'plans.json', not 'nnUNetPlans.json'.
        target = destination / ("fold_0/checkpoint_best.pth" if name == "checkpoint_best.pth"
                                else "plans.json" if name == "nnUNetPlans.json" else name)
        target.parent.mkdir(exist_ok=True, parents=True)
        if target.exists():
            if sha256(target) != actual_hash:
                raise ValueError("destination_contains_conflicting_model_asset")
        else:
            shutil.copyfile(downloaded, target)
        files[name] = {"bytes": downloaded.stat().st_size, "sha256": actual_hash}
    check_publisher_metadata(
        json.loads((destination/"dataset.json").read_text()),
        json.loads((destination/"plans.json").read_text()))
    return {"schema": "opus-cln-original-msd-ct-weights/v1",
            "publisher": REPO, "sourceRevision": info.sha,
            "model": TASK, "nnunetTrainer": TRAINER, "checkpointSHA256":
            files["checkpoint_best.pth"]["sha256"], "files": files,
            "publisherLfsWeightSHA256Verified": True, "downloadedWeights": True,
            "inferenceCompleted": False, "clinicallyValidated": False,
            "licenseDeclaredByPublisher": "cc-by-sa-4.0",
            "patientCloudTransfer": False}


def run_cpu(command: list[str], env: dict, memory_gib: float, timeout_sec: int):
    import psutil
    if not 3 <= memory_gib <= 16 or not 30 <= timeout_sec <= 7200:
        raise ValueError("unsafe_CPU_resource_limits")
    process = subprocess.Popen(command, env=env, start_new_session=True,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    start, peak = time.monotonic(), 0
    try:
        while process.poll() is None:
            try:
                root = psutil.Process(process.pid)
                rss = sum(p.memory_info().rss for p in [root] + root.children(recursive=True)
                          if p.is_running())
                peak = max(peak, rss)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
            if peak > memory_gib * 1024**3:
                raise MemoryError("original_CLN_CPU_process_tree_over_RAM_budget")
            if time.monotonic() - start > timeout_sec:
                raise TimeoutError("original_CLN_CPU_forward_timeout")
            time.sleep(.3)
        if process.returncode:
            raise RuntimeError("original_CLN_nnunet_v2_forward_failed")
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    return {"peakMonitoredProcessTreeRSSBytes": peak}


def infer(args: argparse.Namespace) -> dict:
    if (not args.approved_public_source or not args.source_sha256 or
            len(args.source_sha256) != 64):
        raise ValueError("public_source_and_exact_SHA256_required")
    ct = args.ct
    if (ct is None or not ct.is_file() or not ct.name.endswith(".nii.gz") or
            ct.stat().st_size > MAX_CT_BYTES or
            sha256(ct) != args.source_sha256.lower()):
        raise ValueError("public_CT_hash_or_size_invalid")
    import nibabel as nib
    import numpy as np
    vol = nib.load(str(ct))
    if (len(vol.shape) != 3 or np.prod(vol.shape, dtype=np.int64) > 200_000_000
            or not np.isfinite(vol.affine).all()):
        raise ValueError("unbounded_or_invalid_original_CT_geometry")
    root = args.model_dir / TASK / TRAINER
    weights = root / "fold_0/checkpoint_best.pth"
    if not weights.is_file():
        raise ValueError("original_CLN_checkpoint_not_provisioned")
    check_publisher_metadata(json.loads((root/"dataset.json").read_text()),
                             json.loads((root/"plans.json").read_text()))
    if not args.checkpoint_sha256 or sha256(weights) != args.checkpoint_sha256.lower():
        raise ValueError("publisher_model_checkpoint_SHA256_not_verified")
    if args.output.exists() and any(args.output.iterdir()):
        raise ValueError("existing_results_must_not_be_overwritten")
    binary = shutil.which("nnUNetv2_predict")
    if binary is None:
        raise RuntimeError("original_nnunet_v2_CPU_runner_missing")
    args.output.mkdir(parents=True, exist_ok=True)
    import tempfile
    with tempfile.TemporaryDirectory(prefix="opus-cln-ct-") as tmp:
        source = Path(tmp)/"input"
        source.mkdir()
        shutil.copyfile(ct, source/"case_0000.nii.gz")
        env = dict(os.environ, nnUNet_results=str(args.model_dir.resolve()),
                   CUDA_VISIBLE_DEVICES="-1", OMP_NUM_THREADS="2", MKL_NUM_THREADS="2")
        command = [binary, "-i", str(source), "-o", str(args.output.resolve()),
                   "-d", "502", "-c", "3d_fullres", "-tr", "nnUNetTrainer",
                   "-p", "nnUNetPlans", "-f", "0", "-chk", "checkpoint_best.pth",
                   "-device", "cpu", "-npp", "1", "-nps", "1", "--disable_tta"]
        resources = run_cpu(command, env, args.memory_gib, args.timeout_sec)
    result = args.output/"case.nii.gz"
    if not result.is_file():
        raise ValueError("original_CLN_model_emitted_no_NIfTI_mask")
    # Share native NIfTI spatial validation with Carles while remaining
    # model-specific in the provenance. No clinical/patient claims.
    f = Path(__file__).with_name("carles-task998-ct-cpu.py")
    spec = importlib.util.spec_from_file_location("opus_carles_geometry_only", f)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    scores = mod.inspect_mask(ct, result, args.expert)
    # Actual model positives become separate source-native 3-D tumor candidates.
    # Keep the source affine; do not claim raw DICOM SOP registration.
    from scipy.ndimage import label, find_objects, center_of_mass
    pred_img = nib.load(str(result))
    binary = np.asarray(pred_img.dataobj) == 1
    labels, number = label(binary)
    slices = find_objects(labels)
    voxel_ml = abs(float(np.linalg.det(vol.affine[:3, :3]))) / 1000
    candidates = []
    expert_img = nib.load(str(args.expert)) if args.expert else None
    truth = np.asarray(expert_img.dataobj) > 0 if expert_img else None
    expert_components = None
    if truth is not None:
        expert_components, expert_count = label(truth)
    else:
        expert_count = 0
    matched_experts = set()
    for cid, bounds in enumerate(slices, 1):
        if bounds is None:
            continue
        region = labels[bounds] == cid
        count = int(region.sum())
        local = center_of_mass(region)
        ijk = [float(bounds[k].start + local[k]) for k in range(3)]
        world = (vol.affine @ np.array([*ijk, 1.0]))[:3]
        matched = (sorted(int(v) for v in np.unique(expert_components[bounds][region]) if v > 0)
                   if expert_components is not None else [])
        matched_experts.update(matched)
        candidates.append({
            "modelComponentId": cid, "candidateVoxels": count,
            "candidateVolumeMl": round(count * voxel_ml, 6),
            "sourceVoxelBoundsInclusive": [[int(v.start), int(v.stop - 1)] for v in bounds],
            "sourceVoxelCentroidIJK": [round(v, 3) for v in ijk],
            "sourceNiftiRasCentroidMm": [round(float(v), 3) for v in world],
            "overlapsProvidedExpertTumorMask": bool(matched) if truth is not None else None,
            "matchedExpertComponentIds": matched,
            "clinicalDiagnosisConfirmed": False,
        })
    candidates.sort(key=lambda x: x["candidateVoxels"], reverse=True)
    if sum(c["candidateVoxels"] for c in candidates) != scores["tumorVoxels"]:
        raise ValueError("CLN_individual_candidates_do_not_cover_original_model_mask")
    scores.update({
        "modelTumorComponentCount": number,
        "sourceNativeTumorCandidates": candidates[:250],
        "modelComponentsTruncated": number > 250,
        "expertTumorComponentCount": expert_count if truth is not None else None,
        "expertTumorComponentsDetected": len(matched_experts) if truth is not None else None,
        "expertTumorComponentsMissed": expert_count - len(matched_experts) if truth is not None else None,
        "expertComponentRecallAnyVoxelOverlap": (round(len(matched_experts)/expert_count, 6)
            if expert_count else None),
        "independentLesionSensitivityValidated": False,
    })
    return {"schema": "opus-cln-MSD-CT-real-CPU-research/v1", "model": REPO,
            "sourceSHA256": args.source_sha256.lower(),
            "checkpointSHA256": args.checkpoint_sha256.lower(),
            "caseCount": 1, "realOriginalModelForwardCompleted": True,
            "gpuUsed": False, "patientCloudTransfer": False,
            "clinicallyValidated": False, "independentHoldoutEstablished": False,
            **resources, **scores}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("provision", "infer"), required=True)
    p.add_argument("--model-dir", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--ct", type=Path)
    p.add_argument("--source-sha256")
    p.add_argument("--checkpoint-sha256")
    p.add_argument("--approved-public-source", action="store_true")
    p.add_argument("--expert", type=Path)
    p.add_argument("--output", type=Path)
    p.add_argument("--memory-gib", type=float, default=6)
    p.add_argument("--timeout-sec", type=int, default=1800)
    args = p.parse_args()
    if args.mode == "infer" and args.output is None:
        p.error("--output required for infer")
    try:
        report = (provision(args.model_dir / TASK / TRAINER)
                  if args.mode == "provision" else infer(args))
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"mode": args.mode, "realForward":
                          report.get("realOriginalModelForwardCompleted", False),
                          "weightSHA256": report["checkpointSHA256"],
                          "voxelDice": report.get("voxelDice")}))
    except Exception as e:
        print("ORIGINAL_CLN_CT_NOT_CONFIRMED: " + str(e), file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
