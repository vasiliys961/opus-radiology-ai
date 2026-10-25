#!/usr/bin/env python3
"""Research-only lesion-level detection metrics for native CompAI node masks.

Expert node components are 26-connected. A predicted connected component hits
an expert component only if they share at least one voxel. A candidate is
counted as FP if it touches no expert component. This is not FROC without a
dataset-wide denominator, thresholds and independent case provenance.
"""
import argparse
import hashlib
import json
from pathlib import Path


def score(prediction, expert, ct, max_voxels=25000000):
    import nibabel as nib
    import numpy as np
    from scipy.ndimage import label
    paths = [Path(p) for p in (prediction, expert, ct)]
    imgs = [nib.load(str(p)) for p in paths]
    base = imgs[2]
    if any(im.ndim != 3 or im.shape != base.shape for im in imgs):
        raise ValueError("Only exactly matched native 3D volumes are accepted")
    if not np.isfinite(base.affine).all() or any(
        not np.allclose(im.affine, base.affine, atol=1e-3, rtol=0) for im in imgs[:2]
    ):
        raise ValueError("Native source geometry mismatch")
    if int(np.prod(base.shape)) > max_voxels:
        raise ValueError("Lesion component analysis above bounded RAM budget")
    arrays = [np.asarray(im.dataobj) for im in imgs[:2]]
    if any(not np.isfinite(a).all() or not np.isin(a, (0, 1)).all() for a in arrays):
        raise ValueError("Binary finite masks required")
    struct = np.ones((3, 3, 3), dtype=np.uint8)
    pred, n_pred = label(arrays[0].astype(bool), structure=struct)
    ref, n_ref = label(arrays[1].astype(bool), structure=struct)
    pairs = np.unique(
        np.stack((pred[(pred > 0) & (ref > 0)], ref[(pred > 0) & (ref > 0)]), axis=1),
        axis=0
    )
    hit_pred = set(int(v) for v in pairs[:, 0])
    hit_ref = set(int(v) for v in pairs[:, 1])
    tp = len(hit_ref)
    fn = int(n_ref) - tp
    fp = int(n_pred) - len(hit_pred)
    def filehash(path):
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    return {
        "schema": "opus-compai-model7-lesion-overlap/v1",
        "sourceCTSha256": filehash(paths[2]),
        "predictionMaskSha256": filehash(paths[0]),
        "expertMaskSha256": filehash(paths[1]),
        "matchRule": "26-connected expert/predicted components with >=1 shared native voxel",
        "expertNodeComponents": int(n_ref),
        "predictedNodeComponents": int(n_pred),
        "detectedExpertNodeComponents": tp,
        "missedExpertNodeComponents": fn,
        "unmatchedPredictionComponents": fp,
        "expertComponentRecall": tp / n_ref if n_ref else None,
        "unmatchedPredictionsPerCase": fp,
        "notFROC": True,
        "independentHoldoutVerified": False,
        "clinicalValidation": False
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", required=True, type=Path)
    p.add_argument("--prediction", required=True, type=Path)
    p.add_argument("--expert", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    if a.output.exists():
        raise ValueError("Refusing to overwrite results")
    report = score(a.prediction, a.expert, a.ct)
    a.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report))


if __name__ == "__main__":
    main()
