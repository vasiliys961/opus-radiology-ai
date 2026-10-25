#!/usr/bin/env python3
"""One-command real CompAI Model7 positive-case run plus aligned expert scoring.

Only authentic CompAI pinned trained weights are accepted by the upstream runner.
Requires a lawful deidentified CT and an independently supplied expert lesion mask.
No patient network transfer, no synthetic positive results, no clinical validation claim.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--expert", type=Path, required=True)
    p.add_argument("--nnunet-results", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    a = p.parse_args()
    if a.output.exists():
        raise ValueError("Refusing to overwrite prior results")
    if a.expert.resolve() == a.ct.resolve():
        raise ValueError("Expert mask must be a separate volume")
    original = Path(__file__).with_name("run-compai-mediastinal-lnq-model7.py")
    scorer = Path(__file__).with_name("score-compai-model7-expert.py")
    lesion_scorer = Path(__file__).with_name("score-compai-model7-lesions.py")
    if not original.is_file() or not scorer.is_file() or not lesion_scorer.is_file():
        raise RuntimeError("Pinned runner and source-native scorer required")
    a.output.mkdir(parents=True)
    try:
        work = a.output / "original_forward"
        subprocess.run([
            sys.executable, str(original), "--ct", str(a.ct), "--nnunet-results",
            str(a.nnunet_results), "--dataset", "Dataset050_LNQ_Bouget_NSCLC",
            "--configuration", "3d_fullres", "--fold", "all", "--device",
            a.device, "--output", str(work)
        ], check=True, timeout=3700)
        native = work / "prediction" / "case.nii.gz"
        evidence = work / "evidence.json"
        if not native.is_file() or not evidence.is_file():
            raise RuntimeError("No genuine original trained forward or its evidence")
        original_evidence = json.loads(evidence.read_text(encoding="utf-8"))
        if original_evidence.get("actualOriginalForward") is not True or original_evidence.get("clinicalValidation") is not False:
            raise ValueError("Original inference is not verified research-only")
        scorepath = a.output / "expert_score.json"
        subprocess.run([
            sys.executable, str(scorer), "--ct", str(a.ct),
            "--prediction", str(native), "--expert", str(a.expert),
            "--output", str(scorepath)
        ], check=True, timeout=600)
        lesionpath = a.output / "expert_lesion_score.json"
        subprocess.run([
            sys.executable, str(lesion_scorer), "--ct", str(a.ct),
            "--prediction", str(native), "--expert", str(a.expert),
            "--output", str(lesionpath)
        ], check=True, timeout=600)
        lesion = json.loads(lesionpath.read_text(encoding="utf-8"))
        scored = json.loads(scorepath.read_text(encoding="utf-8"))
        if any(lesion[key] != scored[key] for key in ("sourceCTSha256", "predictionMaskSha256", "expertMaskSha256")):
            raise ValueError("Lesion and voxel scoring not bound to identical inputs")
        if (scored["sourceCTSha256"] != original_evidence["sourceCTSha256"]
                or scored["predictionMaskSha256"] != original_evidence["maskSha256"]):
            raise ValueError("Original forward and scoring have mismatched input or mask")
        report = {
            "schema": "opus-compai-model7-positive-expert-evaluation/v1",
            "model": "CompAI original Model7 fold all",
            "originalForwardVerified": True,
            "sourceNativeGeometryVerified": True,
            "sourceCTSha256": scored["sourceCTSha256"],
            "predictionMaskSha256": scored["predictionMaskSha256"],
            "expertMaskSha256": scored["expertMaskSha256"],
            "voxelTP": scored["TP"], "voxelFP": scored["FP"],
            "voxelFN": scored["FN"], "voxelDice": scored["dice"],
            "voxelSensitivity": scored["sensitivityVoxel"],
            "positiveReferenceVoxelCount": scored["TP"] + scored["FN"],
            "expertNodeComponents": lesion["expertNodeComponents"],
            "detectedExpertNodeComponents": lesion["detectedExpertNodeComponents"],
            "missedExpertNodeComponents": lesion["missedExpertNodeComponents"],
            "unmatchedPredictionComponents": lesion["unmatchedPredictionComponents"],
            "expertComponentRecall": lesion["expertComponentRecall"],
            "notFROC": True,
            "positiveCaseVerified": scored["TP"] + scored["FN"] > 0,
            "independentHoldoutVerified": False,
            "malignancyDetected": None,
            "clinicalValidation": False,
            "physicianReviewRequired": True
        }
        if not report["positiveCaseVerified"]:
            raise ValueError("Expert mask has no positive nodes: not a positive-case evaluation")
        (a.output / "positive_evaluation.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report))
    except BaseException:
        (a.output / "INCOMPLETE_EVALUATION").write_text(
            "No valid complete positive expert evaluation; inspect original logs.\n",
            encoding="utf-8")
        raise


if __name__ == "__main__":
    main()
