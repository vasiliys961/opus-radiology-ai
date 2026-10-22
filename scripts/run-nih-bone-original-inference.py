#!/usr/bin/env python3
"""Original NIH-MIP CT bone lesion nnU-Net inference on authorized research CT.

Requires an isolated nnunetv2 environment and checked-out original Git LFS
publisher weights. Never downloads patient data or triggers cloud transfer.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


MODEL_FOLDER = "nnUNetTrainer__nnUNetPlans__3d_fullres"
DATASET_NAME = "Dataset001_BoneLesions"


def digest(file):
    h = hashlib.sha256()
    with Path(file).open("rb") as stream:
        for buf in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(buf)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ct", type=Path, required=True, help="Deidentified source CT NIfTI")
    parser.add_argument("--publisher-checkout", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--fold", type=int, choices=range(5), default=0)
    parser.add_argument("--timeout", type=int, default=3600)
    args = parser.parse_args()

    import nibabel as nib
    import numpy as np
    import torch

    if not torch.cuda.is_available():
        raise RuntimeError("Isolated CUDA worker required; Mac browser must not run this model")
    source = args.ct.resolve()
    if not source.is_file():
        raise FileNotFoundError(source)
    original = nib.load(str(source))
    if len(original.shape) != 3 or min(original.shape) < 2:
        raise ValueError("Original 3D CT volume required")
    affine = np.asarray(original.affine)
    if not np.isfinite(affine).all() or abs(np.linalg.det(affine[:3, :3])) < 1e-8:
        raise ValueError("Invalid source CT geometry")
    checkout = args.publisher_checkout.resolve()
    folder = checkout / MODEL_FOLDER
    ckpt = folder / f"fold_{args.fold}" / "checkpoint_final.pth"
    if not ckpt.is_file() or ckpt.stat().st_size < 1024 * 1024:
        raise RuntimeError("Real Git LFS checkpoint is absent (or is a pointer)")
    pointer = subprocess.check_output(
        ["git", "-C", str(checkout), "show", f"HEAD:{MODEL_FOLDER}/fold_{args.fold}/checkpoint_final.pth"],
        timeout=20, text=True
    )
    digest_line = next((x[11:] for x in pointer.splitlines() if x.startswith("oid sha256:")), None)
    if not digest_line or digest(ckpt) != digest_line:
        raise ValueError("Original fold checkpoint SHA-256 mismatches Git LFS publisher oid")
    out = args.output.resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError("Refuse stale or nonempty result directory")
    out.mkdir(parents=True, exist_ok=True)
    input_dir = out / "input"
    input_dir.mkdir()
    (input_dir / "case_0000.nii.gz").symlink_to(source)
    predicted_dir = out / "masks"
    # nnUNet_results should refer to the directory containing DatasetXXX_
    # and its trainer/configuration subfolder; no modifications to source.
    results_root = out / "nnunet_results"
    result_dataset = results_root / DATASET_NAME
    result_dataset.mkdir(parents=True)
    (result_dataset / MODEL_FOLDER).symlink_to(folder, target_is_directory=True)
    env = dict(os.environ)
    env["nnUNet_results"] = str(results_root)
    env["nnUNet_n_proc_DA"] = "1"
    cmd = [sys.executable, "-m", "nnunetv2.inference.predict_from_raw_data",
           "-i", str(input_dir), "-o", str(predicted_dir),
           "-d", DATASET_NAME, "-c", "3d_fullres", "-f", str(args.fold),
           "-chk", "checkpoint_final.pth", "-device", "cuda",
           "--disable_tta"]
    subprocess.run(cmd, check=True, env=env, timeout=args.timeout)
    mask_path = predicted_dir / "case.nii.gz"
    if not mask_path.is_file():
        raise RuntimeError("No original nnU-Net lesion mask was produced")
    predicted = nib.load(str(mask_path))
    if predicted.shape != original.shape or not np.allclose(predicted.affine, affine, atol=1e-3, rtol=0):
        raise RuntimeError("Model result not aligned to the source CT")
    labels = np.asarray(predicted.dataobj)
    if not np.isfinite(labels).all() or not np.array_equal(labels, labels.astype(np.uint8)):
        raise ValueError("Unexpected noninteger segmentation labels")
    label_counts = {str(int(v)): int(n) for v, n in zip(*np.unique(labels, return_counts=True))}
    report = {
        "schema": "opus-nih-bone-lesion-original-inference/v1",
        "sourceCTsha256": digest(source), "checkpointSha256": digest(ckpt),
        "fold": args.fold, "maskSHA256": digest(mask_path),
        "voxelVolumeMm3": float(abs(np.linalg.det(affine[:3, :3]))),
        "labelVoxelCounts": label_counts,
        "actualPublisherForward": True, "clinicalValidation": False,
        "maskFile": str(mask_path), "physicianReviewRequired": True,
        "warning": "Only an original tested protocol and independently checked label mapping can authorize malignancy interpretation",
    }
    (out / "evidence.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
