#!/usr/bin/env python3
"""Original Carles Task998 CT lung tumor research runner (nnU-Net v1).

Runs only on a deliberately supplied public NIfTI, with original externally
installed CT checkpoints. Never downloads patient data or publishes images.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

TASK = "Task998_LungCTSegmentation"
TRAINER = "nnUNetTrainerV2__nnUNetPlansv2.1"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def checkpoint(results: Path, fold: int):
    if fold not in range(5):
        raise ValueError("unsupported_fold")
    root = results.resolve()
    folder = root / "nnUNet" / "3d_fullres" / TASK / TRAINER
    weights = folder / ("fold_" + str(fold)) / "model_final_checkpoint.model"
    meta = weights.with_name(weights.name + ".pkl")
    plans = folder / "plans.pkl"
    if "Task999" in str(root) or any(not p.is_file() or p.stat().st_size == 0 for p in (weights, meta, plans)):
        raise ValueError("original_CT_Task998_weights_or_plans_missing")
    return weights


def inspect_mask(ct: Path, prediction: Path, expert: Path | None):
    import nibabel as nib
    import numpy as np
    src = nib.load(str(ct))
    pred = nib.load(str(prediction))
    if len(src.shape) != 3 or src.shape != pred.shape or not np.allclose(
        src.affine, pred.affine, atol=0.02, rtol=0):
        raise ValueError("CT_tumor_mask_not_on_original_source_grid")
    gt = nib.load(str(expert)) if expert else None
    if gt and (gt.shape != src.shape or not np.allclose(src.affine, gt.affine, atol=0.02, rtol=0)):
        raise ValueError("expert_tumor_mask_geometry_mismatch")
    n = tp = fp = fn = 0
    bounds_min, bounds_max = None, None
    source_index_sums = np.zeros(3, dtype=np.float64)
    for z in range(0, src.shape[2], 8):
        sl = (slice(None), slice(None), slice(z, min(z + 8, src.shape[2])))
        array = np.asarray(pred.dataobj[sl])
        if not np.isfinite(array).all() or not np.isin(array, (0, 1)).all():
            raise ValueError("unexpected_original_tumor_mask_labels")
        positive = array == 1
        count = int(np.count_nonzero(positive))
        n += count
        if count:
            ix, iy, iz = np.nonzero(positive)
            index_min = [int(ix.min()), int(iy.min()), int(iz.min()) + z]
            index_max = [int(ix.max()), int(iy.max()), int(iz.max()) + z]
            if bounds_min is None:
                bounds_min, bounds_max = index_min, index_max
            else:
                bounds_min = [min(x, y) for x, y in zip(bounds_min, index_min)]
                bounds_max = [max(x, y) for x, y in zip(bounds_max, index_max)]
            source_index_sums += [float(ix.sum()), float(iy.sum()),
                                  float(iz.sum()) + z * count]
        if gt is not None:
            truth = np.asarray(gt.dataobj[sl]) > 0
            tp += int(np.count_nonzero(positive & truth))
            fp += int(np.count_nonzero(positive & ~truth))
            fn += int(np.count_nonzero(~positive & truth))
    ml = n * float(np.prod(src.header.get_zooms()[:3])) / 1000
    report = {"nativeCTGeometryVerified": True, "tumorVoxels": n,
              "tumorVolumeMl": round(ml, 3), "clinicallyValidated": False,
              "lesionRecallValidated": False, "negativeDiagnosis": False,
              "dicomLpsCoordinatesVerified": False,
              "sourceVoxelBounds": None, "sourceVoxelCentroid": None,
              "niftiWorldCentroidMm": None}
    if n:
        center = source_index_sums / n
        world = src.affine @ np.array([*center, 1.0], dtype=np.float64)
        report["sourceVoxelBounds"] = {"minInclusive": bounds_min,
                                       "maxInclusive": bounds_max}
        report["sourceVoxelCentroid"] = [round(float(x), 3) for x in center]
        report["niftiWorldCentroidMm"] = [round(float(x), 3) for x in world[:3]]
    if gt is not None:
        report.update({"TP": tp, "FP": fp, "FN": fn,
                       "voxelDice": (2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else None),
                       "notIndependentHoldout": True})
    else:
        report["voxelDice"] = None
    return report


def run(args):
    if not args.public_research:
        raise ValueError("approved_public_research_only_no_patient_data")
    if not args.ct.is_file() or not args.ct.name.endswith(".nii.gz") or args.ct.stat().st_size > 1024**3:
        raise ValueError("source_CT_must_be_bounded_NIfTI")
    weights = checkpoint(args.models, args.fold)
    model_hash, source_hash = digest(weights), digest(args.ct)
    if not args.preflight and (not args.pinned_checkpoint_sha256 or
                               model_hash != args.pinned_checkpoint_sha256.lower()):
        raise ValueError("checkpoint_SHA256_must_match_independent_publisher_audit")
    import nibabel as nib
    import numpy as np
    ct_img = nib.load(str(args.ct))
    if (len(ct_img.shape) != 3 or np.prod(ct_img.shape, dtype=np.int64) > 200_000_000 or
        not np.isfinite(ct_img.affine).all()):
        raise ValueError("invalid_or_oversized_public_CT_3D_geometry")
    report = {"schema": "opus-carles-Task998-CT-research/v1", "task": TASK,
              "originalModelSHA256": model_hash, "publicSourceSHA256": source_hash,
              "gpuUsed": False, "patientCloudTransfer": False, "clinicalValidation": False,
              "realForwardCompleted": False,
              "originalPublisherReleaseAuthenticated": False}
    if args.preflight:
        return report
    exe = shutil.which("nnUNet_predict")
    if exe is None:
        raise RuntimeError("original_nnunet_v1_not_installed")
    args.output.mkdir(parents=True, exist_ok=True)
    expected = args.output / "case.nii.gz"
    if expected.exists():
        raise ValueError("output_path_already_contains_prediction")
    with tempfile.TemporaryDirectory(prefix="opus-carles-") as temp:
        input_dir = Path(temp) / "input"
        input_dir.mkdir()
        shutil.copyfile(args.ct, input_dir / "case_0000.nii.gz")
        env = dict(os.environ, RESULTS_FOLDER=str(args.models.resolve()),
                   CUDA_VISIBLE_DEVICES="-1", OMP_NUM_THREADS="2")
        command = [exe, "-i", str(input_dir), "-o", str(args.output.resolve()),
                   "-t", TASK, "-tr", "nnUNetTrainerV2", "-m", "3d_fullres",
                   "-p", "nnUNetPlansv2.1", "-f", str(args.fold),
                   "--num_threads_preprocessing", "1",
                   "--num_threads_nifti_save", "1", "--disable_tta",
                   "--disable_mixed_precision"]
        subprocess.run(command, env=env, check=True, timeout=1800,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not expected.is_file():
        raise ValueError("original_CT_model_output_missing")
    return dict(report, **inspect_mask(args.ct, expected, args.expert), realForwardCompleted=True)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--models", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--expert", type=Path)
    p.add_argument("--pinned-checkpoint-sha256", help="externally audited publisher SHA256 required for forward")
    p.add_argument("--fold", type=int, default=0)
    p.add_argument("--public-research", action="store_true")
    p.add_argument("--preflight", action="store_true")
    args = p.parse_args()
    output = run(args)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"forwardCompleted": output["realForwardCompleted"],
                      "voxelDice": output.get("voxelDice")}))


if __name__ == "__main__":
    main()
