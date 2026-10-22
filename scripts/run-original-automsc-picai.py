#!/usr/bin/env python3
"""Research-only original AutoMSC PICAI fold0 segmentation runner.

Uses publisher's MTL nnUNet implementation in a separately installed isolated
environment. No patient cloud traffic, no implicit clinical clearance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from automsc_prostate_lesions import describe_lesions

MODEL_ID = "cyyu96/AutoMSC-Baselines"
REVISION = "9252036f262e2b89ac1a74322cad77691437a4f3"
WEIGHT_SHA256 = "b75db509e8f4bc2febd4e3cb4c2fc78f42665287bb02db2dd60249f118a1a426"
SUBDIR = "Dataset004_PICAI/nnUNetCLSTrainerMTL__nnUNetPlans__3d_fullres"
FILES = ["dataset.json", "plans.json", "fold_0/checkpoint_best.pth"]


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for piece in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(piece)
    return h.hexdigest()


def inspect_inputs(paths):
    import numpy as np
    import nibabel as nib

    images = [nib.load(str(p)) for p in paths]
    ref = images[0]
    if len(ref.shape) != 3 or any(s < 2 for s in ref.shape):
        raise ValueError("Expected a three-dimensional multi-slice T2 MRI")
    for name, img in zip(("T2W", "ADC", "HBV"), images):
        if len(img.shape) != 3 or img.shape != ref.shape:
            raise ValueError(f"{name}: dimensions do not match T2W")
        if not np.isfinite(img.affine).all() or not np.allclose(
            img.affine, ref.affine, atol=0.001, rtol=0
        ):
            raise ValueError(f"{name}: physical affine differs; register series before inference")
        if not np.isfinite(np.asarray(img.header.get_zooms())).all():
            raise ValueError(f"{name}: invalid voxel spacing")
    return {"shape": list(ref.shape), "affine": ref.affine.tolist(),
            "voxelVolumeMm3": float(abs(np.linalg.det(ref.affine[:3, :3])))}


def prepare_model(cache):
    from huggingface_hub import hf_hub_download
    model = cache / SUBDIR
    model.mkdir(parents=True, exist_ok=True)
    for relative in FILES:
        local = Path(hf_hub_download(repo_id=MODEL_ID, revision=REVISION,
                                     filename=f"{SUBDIR}/{relative}", token=False))
        target = model / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.symlink_to(local.resolve())
    checkpoint = model / FILES[-1]
    if sha256(checkpoint) != WEIGHT_SHA256:
        raise ValueError("Original fold0 checkpoint SHA-256 mismatch; inference refused")
    dataset = json.loads((model / "dataset.json").read_text())
    channels = dataset.get("channel_names", {})
    names = [str(channels.get(str(i), "")).lower() for i in range(3)]
    if names != ["t2w", "adc", "hbv"] and names != ["t2", "adc", "hbv"]:
        raise ValueError(f"Publisher dataset channels differ: {names}")
    labels = dataset.get("labels", {})
    if int(labels.get("tumor", -1)) != 2:
        raise ValueError(f"Publisher labels differ from verified baseline: {labels}")
    return model


def run(args):
    if args.device == "cuda":
        import torch
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is not available; use a separate GPU executor")
    inputs = [Path(s).resolve() for s in (args.t2w, args.adc, args.hbv)]
    if not all(p.is_file() for p in inputs):
        raise FileNotFoundError("All T2W/ADC/HBV source NIfTI files are required")
    geometry = inspect_inputs(inputs)
    model = prepare_model(args.cache.resolve())
    out = args.output.resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError("Output directory must be empty to prevent stale-result reuse")
    out.mkdir(parents=True, exist_ok=True)
    work = out / "input"
    work.mkdir()
    for i, path in enumerate(inputs):
        (work / f"case_000{i}.nii.gz").symlink_to(path)
    predictor = args.publisher_repo.resolve() / "segcls_ensemble_infer.py"
    if not predictor.is_file():
        raise FileNotFoundError("Publisher segcls_ensemble_infer.py required; no stub inference")
    command = [sys.executable, str(predictor), "--input_path", str(work),
               "--output_path", str(out / "predictions"), "--model_path", str(model),
               "--fold", "0", "--checkpoint", "checkpoint_best.pth",
               "--device", args.device, "--cls_mode", "mean"]
    environment = dict(os.environ)
    environment["PYTHONPATH"] = str(args.publisher_repo.resolve()) + os.pathsep + environment.get("PYTHONPATH", "")
    subprocess.run(command, env=environment, check=True, timeout=args.timeout)
    mask_path = out / "predictions" / "case.nii.gz"
    if not mask_path.is_file():
        raise RuntimeError("Publisher completed without actual case.nii.gz segmentation")
    import nibabel as nib
    import numpy as np
    mask_image = nib.load(str(mask_path))
    if tuple(mask_image.shape) != tuple(geometry["shape"]) or not np.allclose(
        mask_image.affine, np.asarray(geometry["affine"]), atol=0.001, rtol=0
    ):
        raise RuntimeError("Output geometry does not match original input; refuse source binding")
    mask = np.asarray(mask_image.dataobj)
    if not np.isin(mask, [0, 1, 2]).all():
        raise RuntimeError("Unexpected class labels in publisher output")
    tumor = mask == 2
    positions = np.argwhere(tumor)
    bbox = [positions.min(axis=0).tolist(), positions.max(axis=0).tolist()] if positions.size else None
    # NIfTI affines map voxel coordinates into RAS+ millimetres; no inferred
    # patient-space localization is permitted without matching source geometry.
    tumor_centroid_ras = None
    tumor_world_bounds_ras = None
    if positions.size:
        affine = np.asarray(mask_image.affine, dtype=np.float64)
        centroid_voxel = positions.astype(np.float64).mean(axis=0)
        tumor_centroid_ras = (
            affine[:3, :3] @ centroid_voxel + affine[:3, 3]
        ).tolist()
        # Rotated volumes require transforming every voxel, not just two
        # opposite index-space corners.
        voxel_world = positions @ affine[:3, :3].T + affine[:3, 3]
        tumor_world_bounds_ras = [
            voxel_world.min(axis=0).tolist(),
            voxel_world.max(axis=0).tolist(),
        ]
    evidence = {
        "schema": "opus-automsc-picai-original-forward/v1",
        "model": MODEL_ID, "revision": REVISION, "checkpointSha256": WEIGHT_SHA256,
        "fold": 0, "channels": ["T2W", "ADC", "HBV"],
        "inputSha256": [sha256(p) for p in inputs],
        "maskSha256": sha256(mask_path), "maskPath": str(mask_path),
        "geometry": geometry, "tumorLabel": 2,
        "tumorVoxels": int(tumor.sum()),
        "tumorVolumeMl": float(tumor.sum() * geometry["voxelVolumeMm3"] / 1000),
        "tumorVoxelBoundingBox": bbox,
        "tumorCentroidRASmm": tumor_centroid_ras,
        "tumorWorldBoundsRASmm": tumor_world_bounds_ras,
        "lesions": describe_lesions(mask, np.asarray(mask_image.affine, dtype=np.float64)),
        "actualPublisherForward": True,
        "clinicalValidation": False, "physicianReviewRequired": True,
        "license": "PICAI CC-BY-NC 4.0: research only",
    }
    if args.expert_mask:
        truth_image = nib.load(str(args.expert_mask))
        if tuple(truth_image.shape) != tuple(mask_image.shape) or not np.allclose(
            truth_image.affine, mask_image.affine, atol=0.001, rtol=0
        ):
            raise ValueError("Expert mask geometry mismatch")
        truth_values = np.asarray(truth_image.dataobj)
        if not np.isin(truth_values, [0, 1, 2, 3, 4, 5]).all():
            raise ValueError("Unexpected expert segmentation labels")
        truth = np.isin(truth_values, args.expert_positive_labels)
        tp = int(np.logical_and(tumor, truth).sum())
        fp = int(np.logical_and(tumor, ~truth).sum())
        fn = int(np.logical_and(~tumor, truth).sum())
        evidence["expertComparison"] = {"positiveLabels": args.expert_positive_labels, "tpVoxels": tp, "fpVoxels": fp,
                                         "fnVoxels": fn,
                                         "dice": 2 * tp / (2 * tp + fp + fn) if (2 * tp + fp + fn) else None}
    (out / "evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({k: evidence[k] for k in ("actualPublisherForward", "tumorVoxels", "tumorVolumeMl", "tumorVoxelBoundingBox")}))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("t2w", "adc", "hbv", "publisher-repo", "output"):
        p.add_argument("--" + name, type=Path, required=True)
    p.add_argument("--cache", type=Path, default=Path.home() / ".cache/opus/automsc")
    p.add_argument("--expert-mask", type=Path)
    p.add_argument("--expert-positive-labels", type=int, nargs="+", default=[2, 3, 4, 5],
                   help="PI-CAI human expert ISUP-positive mask labels (default 2..5)")
    p.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    p.add_argument("--timeout", type=int, default=3600)
    run(p.parse_args())


if __name__ == "__main__":
    main()
