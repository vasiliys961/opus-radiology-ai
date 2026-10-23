#!/usr/bin/env python3
"""Opt-in, offline nnU-Net Dataset191 high-attenuation CT research inference.

No download, remote endpoint, patient upload or clinical diagnosis. Requires
separately installed official LungSCAPE Dataset191 weights and nnUNetv2.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from lungscape191_lesion_components import inspect_components
from lungscape191_streaming_components import inspect_streaming_components
from lungscape191_native_evidence import (
    MAX_FILE_BYTES, MAX_VOXELS, installed_label_map, inspect_native_prediction,
)

MODEL_ID = 191
FOLDS = ("0", "1", "2", "3", "4")
CONFIG = "3d_fullres"


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run(input_file, results, output_dir, *, device="cpu", execute=False, fold="all", step_size=0.5):
    import nibabel as nib
    import numpy as np

    source = Path(input_file).expanduser().resolve(strict=True)
    weights_root = Path(results).expanduser().resolve(strict=True)
    destination = Path(output_dir).expanduser().resolve()
    if (source.is_symlink() or not source.is_file() or source.stat().st_size > MAX_FILE_BYTES
            or not source.name.endswith(".nii.gz")):
        raise ValueError("input must be one explicit local .nii.gz CT file")
    if source.name.endswith("_0000.nii.gz"):
        stem = source.name[:-12]
    else:
        raise ValueError("input filename must end with _0000.nii.gz (nnU-Net one-channel)")
    if not stem or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in stem):
        raise ValueError("case name must contain only alphanumeric, dash or underscore")
    if (destination == source.parent or destination.is_relative_to(source.parent)
            or destination == weights_root or destination.is_relative_to(weights_root)
            or weights_root.is_relative_to(destination)):
        raise ValueError("output must be isolated from inputs and weights")
    models = list(weights_root.glob("Dataset191_*"))
    if len(models) != 1:
        raise ValueError("expected exactly one installed Dataset191_* model directory")
    model = models[0]
    trainers = [p for p in model.iterdir() if p.is_dir() and p.name.endswith("__" + CONFIG)]
    if not model.is_dir() or len(trainers) != 1:
        raise ValueError("missing or ambiguous nnUNetTrainer__nnUNetPlans__3d_fullres installation")
    trainer = trainers[0]
    dataset_json = trainer / "dataset.json"
    if not dataset_json.is_file():
        raise ValueError("original trained nnU-Net dataset.json is absent")
    original_labels = installed_label_map(dataset_json)
    folds = [trainer / ("fold_" + f) / "checkpoint_final.pth" for f in FOLDS]
    if any(not p.is_file() or p.stat().st_size == 0 for p in folds):
        raise ValueError("all five official Dataset191 checkpoint_final.pth folds required")
    cmd_path = shutil.which("nnUNetv2_predict")
    if cmd_path is None:
        raise ValueError("nnUNetv2_predict is not installed")
    image = nib.load(str(source))
    if (len(image.shape) != 3 or any(s < 2 or s > 2048 for s in image.shape)
            or int(np.prod(image.shape)) > MAX_VOXELS):
        raise ValueError("expected a bounded 3D CT image")
    if not np.isfinite(image.affine).all() or abs(float(np.linalg.det(image.affine[:3, :3]))) < 1e-8:
        raise ValueError("invalid source affine")
    if not np.isfinite(image.header.get_zooms()[:3]).all():
        raise ValueError("invalid pixel spacing")
    # Research runner never claims CT HU protocol verification by filename alone.
    source_hash = sha256(source)
    checkpoint_hashes = {f: sha256(p) for f, p in zip(FOLDS, folds)}
    if not execute:
        return {"status": "ready_not_executed", "model": "LungSCAPE Dataset191",
                "source_sha256": source_hash, "shape": list(image.shape),
                "weight_folds_sha256": checkpoint_hashes,
                "original_model_label_map": {str(k): v for k, v in original_labels.items()},
                "clinical_validation": False}
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ValueError("output directory must be empty to prevent stale predictions")
    for key in ("nnUNet_raw", "nnUNet_preprocessed"):
        (destination / key).mkdir(mode=0o700)
    env = os.environ.copy()
    env["nnUNet_results"] = str(weights_root)
    env["nnUNet_raw"] = str(destination / "nnUNet_raw")
    env["nnUNet_preprocessed"] = str(destination / "nnUNet_preprocessed")
    selected_folds = FOLDS if fold == "all" else (fold,)
    if fold not in (*FOLDS, "all") or not 0.5 <= step_size <= 0.95:
        raise ValueError("invalid fold selection or sliding window step")
    invocation = [cmd_path, "-i", str(source.parent), "-o", str(destination),
                  "-d", str(MODEL_ID), "-c", CONFIG, "-f", *selected_folds,
                  "-step_size", str(step_size), "-npp", "1", "-nps", "1",
                  "--disable_tta", "-device", device]
    # Source directory must contain this one case only to avoid accidental other-case processing.
    cases = list(source.parent.glob("*_0000.nii.gz"))
    if len(cases) != 1 or cases[0] != source:
        raise ValueError("put exactly one case in a private inference input directory")
    subprocess.run(invocation, env=env, check=True, timeout=7200)
    output = destination / (stem + ".nii.gz")
    if (output.is_symlink() or not output.is_file()
            or output.stat().st_size > MAX_FILE_BYTES):
        raise RuntimeError("nnU-Net completed without a bounded ordinary mask")
    if sha256(source) != source_hash:
        raise RuntimeError("source CT changed during prediction: no mask binding")
    native_evidence = inspect_native_prediction(source, output, original_labels)
    separate_candidate_evidence = inspect_components(source, output, original_labels)
    if (not separate_candidate_evidence["componentAnalysisCompleted"] and
            separate_candidate_evidence["componentAnalysisReason"] == "bounded_volume_limit"):
        separate_candidate_evidence = inspect_streaming_components(source, output, original_labels)
    report = {"status": "research_mask_generated", "source_sha256": source_hash,
              "mask_sha256": sha256(output), "model": "LungSCAPE Dataset191",
              "model_dataset_json_sha256": sha256(dataset_json),
              "weight_folds_sha256": checkpoint_hashes,
              "trueOriginalTrainedModelForwardCompleted": True,
              "actuallyEvaluatedFolds": list(selected_folds),
              "slidingWindowStepSize": step_size,
              "testTimeAugmentation": False,
              "originalCrossoverWithTrainingUnexcluded": True,
              "noIndependentClinicalValidation": True,
              **native_evidence, **separate_candidate_evidence}
    (destination / "opus-lungscape191-research-report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--nnunet-results", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--device", choices=("cpu", "cuda", "mps"), default="cpu")
    parser.add_argument("--execute", action="store_true", help="explicitly run inference")
    parser.add_argument("--fold", choices=(*FOLDS, "all"), default="all")
    parser.add_argument("--step-size", type=float, default=0.5)
    args = parser.parse_args()
    try:
        report = run(args.input, args.nnunet_results, args.output,
                     device=args.device, execute=args.execute,
                     fold=args.fold, step_size=args.step_size)
        print(json.dumps(report, ensure_ascii=False, indent=2))
    except (ValueError, OSError, subprocess.SubprocessError, RuntimeError, ImportError) as exc:
        print("LungSCAPE191 research runner rejected: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
