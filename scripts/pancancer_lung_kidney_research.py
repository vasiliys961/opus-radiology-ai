#!/usr/bin/env python3
"""Opt-in original pretrained KS987 FLARE PanCancerSeg KIDNEY/LUNG tumor model.

Independent, original trained cancer-specific checkpoints; never run weights
on the user's Mac. Isolated >=64 GiB RAM Linux research executor only.
No download, upload, clinical decisions, model weight/license redistribution.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

ORIGIN = "https://huggingface.co/KS987/PanCancerSeg-Specialized-weights"
VENDOR_INFERENCE = "https://github.com/Kappapapa123/PanCancerSeg-Specialist-Inference"
TRAINER = "nnUNetTrainerWandb2000"
PLANS = "nnUNetResEncUNetMPlans"
ARCH = TRAINER + "__" + PLANS + "__3d_fullres"
MODELS = {"lung": (105, "Lung"), "kidney": (102, "Kidney")}
MIN_AVAILABLE_GIB = 64
MAX_VOXELS = 180_000_000
MAX_FILE_BYTES = 1500 * 1024**2


def hashfile(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def check_original_ct(path):
    import nibabel as nib
    import numpy as np
    if (path.is_symlink() or not path.is_file() or
            not path.name.endswith("_0000.nii.gz") or
            not 1024 < path.stat().st_size < MAX_FILE_BYTES):
        raise ValueError("source must be a bounded local single-channel original CT NIfTI")
    if any(x not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for x in path.name[:-12]):
        raise ValueError("invalid case identifier")
    image = nib.load(str(path))
    if (image.ndim != 3 or min(image.shape) < 24 or
            max(image.shape) > 2048 or math.prod(image.shape) > MAX_VOXELS or
            image.header.get_xyzt_units()[0] != "mm" or
            not np.isfinite(image.affine).all() or
            abs(float(np.linalg.det(image.affine[:3, :3]))) < 1e-8):
        raise ValueError("CT must preserve real bounded 3D physical-mm native grid")
    # Original CT HU: only sample a few genuine slices without allocating a 3D copy.
    values = []
    for z in sorted(set((0, image.shape[2] // 4, image.shape[2] // 2,
                         (image.shape[2] * 3) // 4, image.shape[2] - 1))):
        v = np.asarray(image.dataobj[:, :, z], dtype=np.float32)
        if not np.isfinite(v).all():
            raise ValueError("nonfinite source CT intensity")
        values.append((float(v.min()), float(v.max())))
    if (min(v[0] for v in values) < -3500 or
            max(v[1] for v in values) > 15000 or
            not any(v[0] < -300 and v[1] > 50 for v in values)):
        raise ValueError("CT signal not plausible original HU; do not accept normalized images")
    return {
        "originalCtSha256": hashfile(path),
        "nativeShape": list(image.shape),
        "originalNativeAffine": image.affine.round(7).tolist(),
        "physicalUnits": "mm",
        "originalHuProtocolAssumedNotDICOMConfirmed": True,
        "sourceVoxelsWereNotResampledOrCropped": True,
    }


def check_official_checkpoint(results, anatomy):
    selection = MODELS[anatomy]
    task_id, dataset_name = selection
    folder = results / ("Dataset" + str(task_id) + "_" + dataset_name)
    config = folder / ARCH
    if not config.is_dir() or config.is_symlink():
        raise ValueError("official specialized " + anatomy + " model folder absent")
    chk = config / "fold_0" / "checkpoint_best.pth"
    if chk.is_symlink() or not chk.is_file() or not 10_000 < chk.stat().st_size < 2 * 1024**3:
        raise ValueError("original fold_0 checkpoint_best.pth missing or unbounded")
    data_paths = [config / "dataset.json", folder / "dataset.json"]
    plans_paths = [config / "plans.json", folder / "plans.json"]
    datasets = [p for p in data_paths if p.is_file() and not p.is_symlink()]
    plans = [p for p in plans_paths if p.is_file() and not p.is_symlink()]
    if len(datasets) != 1 or len(plans) != 1:
        raise ValueError("single official plans and dataset JSON required")
    ontology = json.loads(datasets[0].read_text(encoding="utf8"))
    labels = ontology.get("labels")
    if (not isinstance(labels, dict) or len(labels) != 2 or
            labels.get("background") != 0 or set(labels.values()) != {0, 1} or
            ontology.get("file_ending") != ".nii.gz" or
            not isinstance(ontology.get("channel_names"), dict) or
            len(ontology["channel_names"]) != 1 or
            "0" not in ontology["channel_names"]):
        raise ValueError("official 1-channel original binary tumor ontology not verified")
    plan = json.loads(plans[0].read_text(encoding="utf8"))
    if PLANS not in str(plan.get("plans_name", "")):
        raise ValueError("model architecture plan mismatch")
    return {
        "taskId": task_id,
        "dataset": folder.name,
        "originalCheckpointSha256": hashfile(chk),
        "originalDatasetJsonSha256": hashfile(datasets[0]),
        "originalPlansJsonSha256": hashfile(plans[0]),
        "labelNamesFromPublisherDataset": labels,
        "authorSource": ORIGIN,
        "originalCustomTrainerRequired": TRAINER,
        "modelLicenseClaim": "Apache 2.0 per Hugging Face model card; downstream dataset and use rights need review",
        "modelInstalledButForwardNotEstablishedByHashes": True,
    }


def inspect_prediction(source, output):
    import nibabel as nib
    import numpy as np
    from scipy import ndimage
    if (output.is_symlink() or not output.is_file() or
            output.stat().st_size > MAX_FILE_BYTES):
        raise ValueError("no genuine bounded original model mask output")
    img, mask = nib.load(str(source)), nib.load(str(output))
    if (mask.ndim != 3 or img.shape != mask.shape or
            not np.isfinite(mask.affine).all() or
            mask.header.get_xyzt_units()[0] != "mm" or
            not np.allclose(mask.affine, img.affine, rtol=0, atol=1e-4)):
        raise ValueError("model tumor output not on ORIGINAL source CT native grid")
    m = np.asanyarray(mask.dataobj)
    if not np.isin(m, (0, 1)).all():
        raise ValueError("nonbinary model mask; cannot treat multi-label as cancer")
    labels, n = ndimage.label(m == 1, structure=np.ones((3, 3, 3), dtype="uint8"))
    if n > 1000:
        raise ValueError("unbounded model candidate fragments; physician review required")
    volume_ml = abs(float(np.linalg.det(img.affine[:3, :3]))) / 1000
    regions = []
    for label_id, slices in enumerate(ndimage.find_objects(labels), 1):
        if slices is None:
            continue
        coords = np.argwhere(labels[slices] == label_id)
        voxels = int(len(coords))
        low = [int(s.start) for s in slices]
        high = [int(s.stop)-1 for s in slices]
        c = [float(coords[:, j].mean() + low[j]) for j in range(3)]
        ras = (img.affine @ np.array([*c, 1.]))[:3]
        regions.append({
            "nativeBoundsInclusive": [low, high],
            "nativeCentroidVoxel": [round(v, 3) for v in c],
            "rasMmCentroid": [round(float(v), 3) for v in ras],
            "sourceVolumeMl": round(voxels * volume_ml, 4),
            "candidateVoxels": voxels,
        })
    return {
        "predictionMaskOriginalNativeSha256": hashfile(output),
        "originalSourceGridVerified": True,
        "nonBackgroundVoxels": int((m == 1).sum()),
        "candidateComponentCount": len(regions),
        "candidateRegionsNotConfirmedTumors": regions,
        "notIndependentlyClinicallyValidated": True,
        "noExpertMaskMetrics": True,
        "absenceOfMaskCannotExcludeCancer": True,
    }


def available_gib():
    if not sys.platform.startswith("linux"):
        raise ValueError("64GiB original-model research runs are Linux-worker-only; NOT user's Mac")
    mem = Path("/proc/meminfo").read_text().splitlines()
    available = next(int(line.split()[1]) * 1024 for line in mem
                     if line.startswith("MemAvailable:"))
    return available / (1024**3)


def run(source, results, out, anatomy, *, execute=False, device="cpu"):
    source = Path(source).expanduser().resolve(strict=True)
    results = Path(results).expanduser().resolve(strict=True)
    out = Path(out).expanduser().resolve()
    if (not results.is_dir() or out == results or out.is_relative_to(results) or
            out == source.parent or out.is_relative_to(source.parent)):
        raise ValueError("output, model and source paths must be isolated")
    metadata = check_original_ct(source)
    official = check_official_checkpoint(results, anatomy)
    report = {
        "schema": "opus-original-ks987-pancancer-specific-ct/v1",
        "cancerTarget": anatomy + "_tumor_candidate",
        "actualOriginalTrainedForward": False,
        "originalImage": metadata, "originalPretrainedModel": official,
        "clinicalValidation": False, "humanReviewRequired": True,
        "publisherTrainingOverlapExcluded": False,
        "sourceImagesOrMasksInNumericReport": False,
    }
    if not execute:
        return report
    if available_gib() < MIN_AVAILABLE_GIB:
        raise ValueError("large CT resampling requires >=64GiB free RAM: refusing original forward")
    if device == "cuda":
        # Dedicated GPU worker provisioned separately; don't probe user's hardware.
        pass
    if shutil.which("nnUNetv2_predict") is None:
        raise ValueError("original nnUNetv2_predict unavailable")
    if len(list(source.parent.glob("*_0000.nii.gz"))) != 1:
        raise ValueError("inference input directory must have exactly one original CT")
    if out.exists():
        raise ValueError("output folder already exists; no stale predictions")
    out.mkdir(mode=0o700, parents=True)
    (out / "raw").mkdir(mode=0o700)
    (out / "preprocessed").mkdir(mode=0o700)
    env = os.environ.copy()
    env["nnUNet_results"] = str(results)
    env["nnUNet_raw"] = str(out / "raw")
    env["nnUNet_preprocessed"] = str(out / "preprocessed")
    args = ["nnUNetv2_predict", "-i", str(source.parent), "-o", str(out),
            "-d", str(official["taskId"]), "-c", "3d_fullres",
            "-f", "0", "-tr", TRAINER, "-p", PLANS,
            "-chk", "checkpoint_best.pth", "-device", device,
            "-npp", "1", "-nps", "1", "--disable_tta"]
    subprocess.run(args, env=env, check=True, timeout=7200)
    if hashfile(source) != metadata["originalCtSha256"]:
        raise ValueError("original source changed during real forward")
    predicted = out / (source.name[:-12] + ".nii.gz")
    report["realModelPrediction"] = inspect_prediction(source, predicted)
    report["actualOriginalTrainedForward"] = True
    (out / "pancancer-original-numeric.json").write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--nnunet-results", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--target", choices=sorted(MODELS), required=True)
    p.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    p.add_argument("--execute", action="store_true")
    args = p.parse_args()
    try:
        print(json.dumps(run(args.ct, args.nnunet_results,
                             args.output, args.target,
                             execute=args.execute, device=args.device), indent=2))
        return 0
    except (ValueError, OSError, ImportError, RuntimeError, subprocess.SubprocessError) as exc:
        print("Original specific tumor model rejected: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
