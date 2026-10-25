#!/usr/bin/env python3
"""Score genuine CompAI Model7 segmentation against a separately supplied expert NIfTI.

Research-only. Refuses non-aligned images and non-binary masks. This does NOT
establish independent validation unless case provenance and training exclusions
are independently established. Outputs numeric JSON only, never patient pixels.
"""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def score(prediction, expert, original_ct):
    import nibabel as nib
    import numpy as np
    files = [Path(p) for p in (prediction, expert, original_ct)]
    imgs = [nib.load(str(p)) for p in files]
    if any(im.ndim != 3 for im in imgs):
        raise ValueError("All volumes must be 3D")
    ref = imgs[2]
    if any(im.shape != ref.shape or not np.allclose(im.affine, ref.affine, atol=1e-3, rtol=0)
           for im in imgs[:2]):
        raise ValueError("Expert, prediction and original CT must share native voxel shape and affine")
    if not np.isfinite(ref.affine).all() or abs(np.linalg.det(ref.affine[:3, :3])) < 1e-8:
        raise ValueError("Invalid affine")
    if int(np.prod(ref.shape)) > 180_000_000:
        raise ValueError("Volume beyond bounded scorer limit")
    tp = fp = fn = tn = 0
    for k in range(ref.shape[2]):
        slices = [np.asarray(im.dataobj[:, :, k]) for im in imgs[:2]]
        if any(not np.isfinite(s).all() or not np.isin(s, (0, 1)).all() for s in slices):
            raise ValueError("Both masks must be binary and finite")
        p, e = (s.astype(bool) for s in slices)
        tp += int(np.count_nonzero(p & e))
        fp += int(np.count_nonzero(p & ~e))
        fn += int(np.count_nonzero(~p & e))
        tn += int(np.count_nonzero(~p & ~e))
    dice = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else None
    iou = tp / (tp + fp + fn) if tp + fp + fn else None
    return {
        "schema": "opus-compai-model7-expert-voxel-score/v1",
        "sourceCTSha256": digest(files[2]),
        "predictionMaskSha256": digest(files[0]),
        "expertMaskSha256": digest(files[1]),
        "sourceShape": list(ref.shape),
        "TP": tp, "FP": fp, "FN": fn, "TN": tn,
        "dice": dice, "iou": iou,
        "sensitivityVoxel": tp / (tp + fn) if tp + fn else None,
        "positivePredictiveValueVoxel": tp / (tp + fp) if tp + fp else None,
        "zeroPositiveReference": tp + fn == 0,
        "voxelVolumeMm3": abs(float(np.linalg.det(ref.affine[:3, :3])))
            if ref.header.get_xyzt_units()[0] == "mm" else None,
        "independentHoldoutVerified": False,
        "clinicalValidation": False,
        "physicianReviewRequired": True
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", required=True, type=Path)
    p.add_argument("--prediction", required=True, type=Path)
    p.add_argument("--expert", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    if a.output.exists():
        raise ValueError("Refusing to overwrite existing evidence")
    result = score(a.prediction, a.expert, a.ct)
    a.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
