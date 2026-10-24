#!/usr/bin/env python3
"""Run genuine KS987 kidney nnU-Net fold0 and score on exact admitted KiTS23 positive CT.

Runs ONLY in isolated >=64GiB Linux research environment. No patient/cloud mode.
Existing executor must prove genuine publisher checkpoint SHA and native geometry.
Expert label is consumed only AFTER forward is completed.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent

def load_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def execute(ct: Path, expert: Path, model_results: Path, output: Path, device: str):
    if device not in ("cpu", "cuda"):
        raise ValueError("unsupported_device")
    executor = load_module("pancancer_lung_kidney_research.py", "ks987_executor")
    scorer = load_module("score-kits23-original-renal-tumor.py", "kits23_scorer")
    paths = [p.resolve(strict=True) for p in (ct, expert, model_results)]
    ct, expert, model_results = paths
    if ct.is_symlink() or expert.is_symlink() or model_results.is_symlink():
        raise ValueError("original_sources_must_not_be_symlinks")
    if scorer.sha256(ct) != scorer.CT_SHA or scorer.sha256(expert) != scorer.EXPERT_SHA:
        raise ValueError("not_exact_public_admitted_KiTS23_case_00021_and_expert_mask")
    if ct.name != "case_00021_0000.nii.gz":
        raise ValueError("original_CT_requires_nnUNet_case_00021_0000_filename")
    if not output.parent.is_dir() or output.exists() or output.is_symlink():
        raise ValueError("fresh_output_directory_required")
    checkpoint = (model_results / "Dataset102_Kidney" /
        executor.ARCH / "fold_0" / "checkpoint_best.pth")
    if not checkpoint.is_file() or checkpoint.is_symlink() or scorer.sha256(checkpoint) != scorer.CHECKPOINT_SHA:
        raise ValueError("verified_original_KS987_kidney_checkpoint_required")
    # Original trained forward is mandatory. Never fall back to synthetic masks.
    result = executor.run(ct, model_results, output, "kidney", execute=True, device=device)
    if result.get("actualOriginalTrainedForward") is not True:
        raise ValueError("original_trained_forward_not_completed")
    prediction = output / "case_00021.nii.gz"
    if not prediction.is_file() or prediction.is_symlink():
        raise ValueError("original_prediction_missing")
    if scorer.sha256(ct) != scorer.CT_SHA or scorer.sha256(expert) != scorer.EXPERT_SHA:
        raise ValueError("source_or_expert_changed_during_forward")
    scores = scorer.score(ct, expert, prediction, checkpoint_path=checkpoint)
    summary = {
        "schema": "opus-ks987-kits23-expert-positive-real-forward/v1",
        "originalModelForwardCompleted": True,
        "model": "KS987/PanCancerSeg-Specialized-weights Dataset102_Kidney fold0",
        "modelCheckpointSha256": scorer.CHECKPOINT_SHA,
        "ctSha256": scorer.CT_SHA, "expertSha256": scorer.EXPERT_SHA,
        "predictionSha256": scores["modelMaskSha256"],
        "voxelTP": scores["voxelTP"], "voxelFP": scores["voxelFP"],
        "voxelFN": scores["voxelFN"], "voxelDice": scores["voxelDice"],
        "expertTumorComponentMatching": scores["expertTumorComponentMatching"],
        "independentValidation": False, "trainingOverlapExcluded": False,
        "clinicalValidation": False, "patientUseAllowed": False,
    }
    (output / "ks987-kits23-real-forward-score.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf8")
    return summary

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", required=True, type=Path)
    p.add_argument("--expert", required=True, type=Path)
    p.add_argument("--nnunet-results", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    p.add_argument("--execute-original-public-forward", action="store_true")
    args = p.parse_args()
    if not args.execute_original_public_forward:
        p.error("explicit --execute-original-public-forward required")
    try:
        score = execute(args.ct, args.expert, args.nnunet_results, args.output, args.device)
        print(json.dumps(score))
    except (ValueError, OSError, RuntimeError, ImportError) as exc:
        print("Real KiTS23 KS987 inference rejected: " + str(exc), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
