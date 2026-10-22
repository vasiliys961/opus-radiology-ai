#!/usr/bin/env python3
"""Research-only original CompAI LNQ2023 mediastinal lymph node inference.

Requires separately checked-out official CompAI model7 nnUNetv2 configuration
and original trained weights (no substitution with TotalSegmentator anatomy).
Do not infer cancer or primary mediastinal neoplasms from lymph node masks.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1048576), b""):
            h.update(block)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--nnunet-results", type=Path, required=True,
                   help="directory containing CompAI original DatasetXXX_* model bundle")
    p.add_argument("--dataset", required=True, help="CompAI ORIGINAL nnUNet dataset identifier")
    p.add_argument("--configuration", default="3d_fullres")
    p.add_argument("--fold", choices=("all",), default="all")
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()

    import nibabel as nib
    import numpy as np
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("An isolated CUDA executor is required")
    source = a.ct.resolve()
    if not source.is_file() or source.suffixes[-2:] != [".nii", ".gz"]:
        raise ValueError("Original deidentified chest CT NIfTI is required")
    reference = nib.load(str(source))
    if reference.ndim != 3 or not np.isfinite(reference.affine).all():
        raise ValueError("Non-3D or invalid source CT")
    model_root = a.nnunet_results.resolve()
    candidates = list(model_root.glob("Dataset*"))
    target = [x for x in candidates if x.name == a.dataset]
    if a.dataset != "Dataset050_LNQ_Bouget_NSCLC":
        raise ValueError("Model7 pinned publisher dataset required")
    if len(target) != 1:
        raise ValueError("Exact publisher original dataset model folder not found")
    trainers = [x for x in target[0].iterdir() if x.is_dir()
                and "__" + a.configuration in x.name]
    if len(trainers) != 1:
        raise ValueError("Original CompAI training configuration absent or ambiguous")
    checkpoint = trainers[0] / f"fold_{a.fold}" / "checkpoint_final.pth"
    if not checkpoint.is_file() or checkpoint.stat().st_size != 249378174:
        raise ValueError("Original trained checkpoint missing or Git LFS pointer")
    if sha256(checkpoint) != "1cd4a5dd5601ad1a538cda1eda814ea914b48b2e29ec4064b00b285a7a5706c2":
        raise ValueError("Original CompAI Model7 checkpoint SHA-256 mismatch")
    if a.output.exists() and any(a.output.iterdir()):
        raise ValueError("Output must be empty")
    a.output.mkdir(parents=True, exist_ok=True)
    input_folder = a.output / "input"
    input_folder.mkdir()
    (input_folder / "case_0000.nii.gz").symlink_to(source)
    out_folder = a.output / "prediction"
    environment = dict(os.environ)
    environment["nnUNet_results"] = str(model_root)
    cmd = [sys.executable, "-m", "nnunetv2.inference.predict_from_raw_data",
           "-i", str(input_folder), "-o", str(out_folder), "-d", a.dataset,
           "-c", a.configuration, "-f", str(a.fold), "-chk",
           "checkpoint_final.pth", "-device", "cuda", "--disable_tta"]
    subprocess.run(cmd, check=True, env=environment, timeout=3600)
    path = out_folder / "case.nii.gz"
    if not path.is_file():
        raise RuntimeError("Official trained model produced no mask")
    image = nib.load(str(path))
    if image.shape != reference.shape or not np.allclose(image.affine, reference.affine, atol=1e-3, rtol=0):
        raise ValueError("Predicted mask not bound to source physical CT geometry")
    mask = np.asarray(image.dataobj)
    if not np.isin(mask, [0, 1]).all():
        raise ValueError("Original mediastinal LN prediction expected binary")
    voxels = int(np.count_nonzero(mask))
    report = {"schema": "opus-compai-lnq-model7-original-forward/v1",
              "originalModel": "CompAI MediastinalLymphNodeSegmentation",
              "source": "https://gitlab.lrz.de/compai/MediastinalLymphNodeSegmentation",
              "sourceCTSha256": sha256(source), "checkpointSha256": sha256(checkpoint),
              "maskSha256": sha256(path), "fold": a.fold,
              "candidateVoxels": voxels,
              "candidateVolumeMl": float(voxels * abs(np.linalg.det(image.affine[:3, :3])) / 1000),
              "actualOriginalForward": True, "malignancyDetected": None,
              "clinicalValidation": False, "physicianReviewRequired": True}
    (a.output / "evidence.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
