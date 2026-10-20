#!/usr/bin/env python3
"""Actual external nnU-Net WMH model CPU bridge; no default download or patient mode.

Research only. FLAIR hyperintensity mask is not a diagnosis of multiple
sclerosis or cerebral small vessel disease. Original 'wmh_seg' checkpoint must
already be provisioned in an isolated external no-network CPU worker.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

PUBLISHER = "https://github.com/jinghangli98/wmh_seg"
MODEL_REV = "a5ad55c6dec7cb2d4bd7b419a3e7d0c14e72aaee"
VERSION = "1.6.0"
MAX_BYTES = 900*1024**2
MAX_VOXELS = 80_000_000


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024*1024), b""):
            h.update(part)
    return h.hexdigest()


def safe_scan(path):
    import nibabel as nib
    import numpy as np
    if path.is_symlink() or not path.is_file() or not 100 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("original_FLAIR_file_invalid_or_oversized")
    img = nib.load(str(path))
    if len(img.shape) != 3 or np.prod(img.shape, dtype=np.int64) > MAX_VOXELS:
        raise ValueError("invalid_or_unbounded_brain_MRI")
    a = img.affine
    mm = np.linalg.norm(a[:3, :3], axis=0)
    if (not np.isfinite(a).all() or not np.allclose(a[3], (0, 0, 0, 1))
            or np.any(mm < .3) or np.any(mm > 5) or
            abs(np.linalg.det(a[:3, :3])) < .03):
        raise ValueError("invalid_MRI_native_affine")
    return img


def original_model(directory, pinned_sha):
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("unprovisioned_original_wmh_model")
    for filename in ("dataset.json", "plans.json", "fold_0/checkpoint_final.pth"):
        p = directory / filename
        if p.is_symlink() or not p.is_file() or p.stat().st_size == 0:
            raise ValueError("required_original_pretrained_wmh_file_missing")
    weights = directory/"fold_0/checkpoint_final.pth"
    if not pinned_sha or len(pinned_sha) != 64 or digest(weights) != pinned_sha.lower():
        raise ValueError("original_WMH_checkpoint_SHA256_mismatch")
    import importlib.metadata
    if importlib.metadata.version("wmh_seg") != VERSION:
        raise ValueError("unpinned_wmh_seg_package_version")
    return weights


def process_cpu(command, env, rss_limit_gib, timeout_sec):
    import psutil
    if not 3 <= rss_limit_gib <= 16 or not 120 <= timeout_sec <= 7200:
        raise ValueError("invalid_research_worker_limit")
    p = subprocess.Popen(command, env=env, start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    start, peak = time.monotonic(), 0
    try:
        while p.poll() is None:
            try:
                proc = psutil.Process(p.pid)
                tree = [proc]+proc.children(recursive=True)
                rss = sum(x.memory_info().rss for x in tree if x.is_running())
                peak = max(peak, rss)
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
            if peak > rss_limit_gib*1024**3:
                raise MemoryError("true_WMH_CPU_ram_budget_exceeded")
            if time.monotonic()-start > timeout_sec:
                raise TimeoutError("true_WMH_CPU_inference_timeout")
            time.sleep(.25)
        if p.returncode != 0:
            raise RuntimeError("original_WMH_nnUNet_CPU_forward_failed")
        return peak
    finally:
        if p.poll() is None:
            os.killpg(p.pid, signal.SIGKILL)
        p.wait()


def inspect_mask(source, mask, mask_sha):
    import nibabel as nib
    import numpy as np
    from scipy.ndimage import label, find_objects
    original = safe_scan(source)
    result = safe_scan(mask)
    if result.shape != original.shape or not np.allclose(
            original.affine, result.affine, atol=.02, rtol=0):
        raise ValueError("WMH_output_does_not_reproject_to_original_FLAIR")
    if result.get_data_dtype().kind not in "biu":
        raise ValueError("original_WMH_output_not_binary")
    vox = np.asarray(result.dataobj)
    if not np.isin(vox, (0, 1)).all():
        raise ValueError("original_WMH_class_ontology_not_binary")
    cc, n = label(vox == 1)
    if n > 5000:
        raise ValueError("unbounded_WMH_component_count")
    coords = find_objects(cc)
    candidates = []
    for index, spans in enumerate(coords, start=1):
        if spans is None:
            continue
        part = cc[spans] == index
        count = int(part.sum())
        if not count:
            continue
        local = np.argwhere(part)
        offset = np.array([s.start for s in spans])
        centroid = offset + local.mean(axis=0)
        world = original.affine @ np.r_[centroid, 1]
        candidates.append({"component": index, "voxels": count,
                           "volumeMl": round(count*abs(float(np.linalg.det(original.affine[:3, :3])))/1000, 5),
                           "sourceVoxelBoundsInclusive": [[int(s.start) for s in spans],
                                                          [int(s.stop-1) for s in spans]],
                           "centroidNiftiRasMm": [round(float(x), 3) for x in world[:3]]})
    return {"originalPredictedMaskSHA256": mask_sha,
            "candidateVoxelCount": int(np.count_nonzero(vox)),
            "candidateComponentCount": len(candidates),
            "totalPredictedHyperintensityMl": round(sum(x["volumeMl"] for x in candidates), 5),
            "candidateComponents": candidates,
            "emptyMaskIsNotNormalStudy": True,
            "originDICOMFrameMappingVerified": False,
            "WMHVsMSVsOtherTissueEtiologyIndeterminate": True}




def evaluate_lesion_components(source_img, pred_img, expert_img):
    """3D 26-connected component detection on authentic, source-aligned WMH masks.

    Any source-voxel overlap matches at most ONE predicted and ONE expert
    component. This is a descriptive *single-case*, uncalibrated sensitivity
    at any-overlap, not proof of distinguishing lacunes, MS or vascular WMH.
    Challenge label 2 (other pathology) is excluded from both components.
    """
    import numpy as np
    from scipy.ndimage import label

    shape = source_img.shape
    if np.prod(shape, dtype=np.int64) > MAX_VOXELS:
        raise ValueError("WMH_lesion_level_volume_unbounded")
    reference = np.zeros(shape, dtype=np.bool_)
    predicted = np.zeros(shape, dtype=np.bool_)
    for z in range(shape[2]):
        gt = np.asarray(expert_img.dataobj[:, :, z])
        pr = np.asarray(pred_img.dataobj[:, :, z])
        if (not np.isin(gt, (0, 1, 2)).all()
                or not np.isin(pr, (0, 1)).all()):
            raise ValueError("WMH_component_label_ontology_invalid")
        valid = gt != 2
        reference[:, :, z] = (gt == 1)
        predicted[:, :, z] = (pr == 1) & valid

    connectivity = np.ones((3, 3, 3), dtype=np.uint8)
    reference_cc, n_ref = label(reference, structure=connectivity)
    prediction_cc, n_pred = label(predicted, structure=connectivity)
    if n_ref > 5000 or n_pred > 5000:
        raise ValueError("WMH_lesion_components_exceed_safe_limit")
    # Sparse per-slice intersections, no giant (Nref * Npred) matrix.
    pair_counts = {}
    for z in range(shape[2]):
        a = reference_cc[:, :, z]
        b = prediction_cc[:, :, z]
        touched = (a > 0) & (b > 0)
        if not np.any(touched):
            continue
        pairs, count = np.unique(
            np.stack((a[touched], b[touched]), axis=1), axis=0,
            return_counts=True)
        for pair, n in zip(pairs, count):
            key = (int(pair[0]), int(pair[1]))
            pair_counts[key] = pair_counts.get(key, 0) + int(n)
    # Highest-overlap first; each connected component matches at most once.
    assigned_ref, assigned_pred = set(), set()
    for (rid, pid), overlap in sorted(
            pair_counts.items(), key=lambda x: (-x[1], x[0])):
        if rid not in assigned_ref and pid not in assigned_pred:
            assigned_ref.add(rid)
            assigned_pred.add(pid)
    found = len(assigned_ref)
    return {
        "expertLesionComponents26Connectivity": int(n_ref),
        "predictedLesionComponents26Connectivity": int(n_pred),
        "matchedExpertLesionsAnyVoxelOneToOne": found,
        "missedExpertLesions": int(n_ref - found),
        "unmatchedPredictedLesionComponents": int(n_pred - found),
        "lesionRecallAnyOverlap": found / n_ref if n_ref else None,
        "falsePositiveComponentsPerStudy": int(n_pred - found),
        "singleCaseAnyVoxelOverlapNotValidatedDetection": True,
        "otherPathologyLabel2ExcludedFromComponentScoring": True,
        "independentHoldout": False,
        "clinicalValidation": False,
    }


def compare_native_expert(source, prediction, expert, expected_expert_sha256):
    """Voxel-wise WMH overlap on genuine original source grid, bounded by 2-D slices.

    WMH Challenge annotation class 2 denotes OTHER pathology, not WMH:
    report and exclude it from denominators (never silently label it normal).
    A single-case score is not independent model validation.
    """
    import re
    import nibabel as nib
    import numpy as np
    if not re.fullmatch(r"[0-9a-f]{64}", expected_expert_sha256.lower()):
        raise ValueError("expert_original_SHA256_required")
    source_img = safe_scan(source)
    pred_img = safe_scan(prediction)
    expert_img = safe_scan(expert)
    if digest(expert) != expected_expert_sha256.lower():
        raise ValueError("original_expert_mask_SHA256_mismatch")
    if (source_img.shape != pred_img.shape or source_img.shape != expert_img.shape or
            not np.allclose(source_img.affine, pred_img.affine, atol=.02, rtol=0) or
            not np.allclose(source_img.affine, expert_img.affine, atol=.02, rtol=0)):
        raise ValueError("original_expert_source_prediction_native_geometry_mismatch")
    # Published WMH Challenge NIfTI expert files can use float storage even
    # though their *voxel labels* are categorical integers (0/1/2). Reject
    # fractional/nonfinite values slice-by-slice below instead of rejecting
    # a valid publisher-provided float32 label header. Predictions still
    # require an integer binary-mask storage dtype.
    if pred_img.get_data_dtype().kind not in "biu":
        raise ValueError("prediction_must_have_integer_label_storage")
    if expert_img.get_data_dtype().kind not in "biuf":
        raise ValueError("expert_mask_must_have_numeric_label_storage")
    tp = fp = fn = tn = ignored = 0
    for z in range(source_img.shape[2]):
        pred = np.asarray(pred_img.dataobj[:, :, z])
        truth = np.asarray(expert_img.dataobj[:, :, z])
        if not np.isin(pred, (0, 1)).all():
            raise ValueError("prediction_WMH_binary_ontology_invalid")
        if not np.isin(truth, (0, 1, 2)).all():
            raise ValueError("expert_WMH_challenge_ontology_invalid")
        valid = truth != 2
        ignored += int(np.count_nonzero(~valid))
        tp += int(np.count_nonzero(valid & (pred == 1) & (truth == 1)))
        fp += int(np.count_nonzero(valid & (pred == 1) & (truth == 0)))
        fn += int(np.count_nonzero(valid & (pred == 0) & (truth == 1)))
        tn += int(np.count_nonzero(valid & (pred == 0) & (truth == 0)))
    if tp + fn == 0:
        raise ValueError("reference_WMH_positive_required_for_positive_benchmark")
    lesion_components = evaluate_lesion_components(source_img, pred_img, expert_img)
    return {
        **lesion_components,
        "originalExpertWMHMaskSHA256": expected_expert_sha256.lower(),
        "sameOriginalNativeGrid": True,
        "expertOtherPathologyLabel2ExcludedVoxels": ignored,
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "dice": 2 * tp / (2 * tp + fp + fn),
        "sensitivity": tp / (tp + fn),
        "precision": tp / (tp + fp) if tp + fp else 0.0,
        "singleCaseResearchScoreNotIndependentValidation": True,
        "clinicalValidation": False
    }


def execute(args):
    if (not args.approved_public_research or not args.flair_protocol_confirmed
            or not args.public_source_url.startswith("https://")
            or not args.public_source_license.strip()):
        raise ValueError("licensed_public_FLAIR_research_only")
    safe_scan(args.flair)
    if digest(args.flair) != args.flair_sha256.lower():
        raise ValueError("original_public_FLAIR_SHA256_mismatch")
    original_model(args.model_dir, args.checkpoint_sha256)
    if args.mask_out.is_symlink() or args.mask_out.exists():
        raise ValueError("source_bound_mask_output_must_be_new")
    cli = shutil.which("wmh_seg")
    if not cli:
        raise ValueError("external_original_wmh_seg_CLI_not_installed")
    args.mask_out.parent.mkdir(exist_ok=True, parents=True)
    env = dict(os.environ, CUDA_VISIBLE_DEVICES="-1", OMP_NUM_THREADS="2",
               MKL_NUM_THREADS="2", WMH_SEG_INVIVO_DIR=str(args.model_dir.resolve()),
               HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    peak = process_cpu([cli, "-i", str(args.flair.resolve()),
                        "-o", str(args.mask_out.resolve()), "--invivo",
                        "--folds", "0"], env, args.rss_limit_gib, args.timeout_sec)
    metrics = inspect_mask(args.flair, args.mask_out, digest(args.mask_out))
    if bool(args.expert) != bool(args.expert_sha256):
        raise ValueError("expert_and_original_SHA256_must_be_supplied_together")
    overlap = (compare_native_expert(args.flair, args.mask_out, args.expert,
                                     args.expert_sha256)
               if args.expert else None)
    return {"schema": "opus-original-wmh-source-MRI-CPU-research/v1",
            "publisher": PUBLISHER, "publisherRevision": MODEL_REV,
            "version": VERSION, "sourceFLAIRSHA256": args.flair_sha256.lower(),
            "checkpointSHA256": args.checkpoint_sha256.lower(),
            "studySourceURL": args.public_source_url,
            "sourceRights": args.public_source_license,
            "realTrainedOriginalWMHModelForwardCompleted": True,
            "sourceCodeAndCheckpointCommercialRights": "NOT_VERIFIED",
            "modelRunFold": 0, "peakObservedProcessTreeRSSBytes": peak,
            "clinicallyValidated": False, "patientCloudTransfer": False,
            "originalExpertOverlap": overlap,
            "trainingOverlapIndependentlyExcluded": False,
            **metrics}


def main():
    p = argparse.ArgumentParser()
    for option in ("flair", "model-dir", "mask-out", "report"):
        p.add_argument("--"+option, required=True, type=Path)
    p.add_argument("--flair-sha256", required=True)
    p.add_argument("--checkpoint-sha256", required=True)
    p.add_argument("--expert", type=Path, help="Original native-grid expert WMH mask (0/1/2); optional research benchmark")
    p.add_argument("--expert-sha256", help="SHA-256 of original expert NIfTI bytes")
    p.add_argument("--public-source-url", required=True)
    p.add_argument("--public-source-license", required=True)
    p.add_argument("--approved-public-research", action="store_true")
    p.add_argument("--flair-protocol-confirmed", action="store_true")
    p.add_argument("--rss-limit-gib", type=float, default=6)
    p.add_argument("--timeout-sec", type=int, default=2400)
    a = p.parse_args()
    result = execute(a)
    if a.report.is_symlink() or a.report.exists():
        p.error("numeric_report_output_must_be_new")
    a.report.parent.mkdir(exist_ok=True, parents=True)
    a.report.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps({"realForward": True, "candidateCount": result["candidateComponentCount"],
                      "independentValidation": False}))


if __name__ == "__main__":
    main()
