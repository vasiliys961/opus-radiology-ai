#!/usr/bin/env python3
"""Research-only original KiTS23 renal tumor metrics from a REAL external model mask.

Requires exact known CT+expert bytes, matching prediction native grid and documented
original checkpoint SHA. No synthetic forward, no claims of independent validation.
Only aggregate numeric metadata is written. Mask stays private.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

CT_SHA = "c8fc76065ce316d6935c3dc87490606381d19fbff1bdd43616814e0cde0c0637"
EXPERT_SHA = "0292f2683b376043f478788624a8fdd924ce736c98626378fb897d4723991b50"
CHECKPOINT_SHA = "5a1c9e2894160d50dfa0f8c0ac0a88198897973f642c0cbeb33e935457fd9d8c"
MAX_VOXELS = 230_000_000


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def score(source_path, expert_path, prediction_path, *, checkpoint_path):
    import nibabel as nib
    import numpy as np

    paths = [Path(p).resolve(strict=True) for p in (
        source_path, expert_path, prediction_path, checkpoint_path)]
    if len(set(paths)) != 4 or any(p.is_symlink() or not p.is_file() for p in paths):
        raise ValueError("four separate ordinary source, expert, prediction and original weights files required")
    if any(p.stat().st_size > 900 * 1024**2 for p in paths[:3]):
        raise ValueError("NIfTI exceeds research bounded file size")
    if sha256(paths[0]) != CT_SHA or sha256(paths[1]) != EXPERT_SHA:
        raise ValueError("not the exact admitted genuine KiTS23 CT and expert label source")
    if sha256(paths[3]) != CHECKPOINT_SHA:
        raise ValueError("not the verified original KS987 kidney model checkpoint")
    src, expert, pred = [nib.load(str(p)) for p in paths[:3]]
    if (src.ndim != 3 or expert.ndim != 3 or pred.ndim != 3
            or src.shape != expert.shape or src.shape != pred.shape
            or int(np.prod(src.shape)) > MAX_VOXELS):
        raise ValueError("original study and both masks must share the same bounded 3D grid")
    if (not np.isfinite(src.affine).all() or abs(float(np.linalg.det(src.affine[:3,:3]))) < 1e-8
            or not np.allclose(src.affine, expert.affine, atol=1e-4, rtol=0)
            or not np.allclose(src.affine, pred.affine, atol=1e-4, rtol=0)
            or len(set(n.header.get_xyzt_units()[0] for n in (src,expert,pred))) != 1):
        raise ValueError("source/expert/prediction affine or spatial units mismatch; resample externally with provenance")
    if expert.header.get_data_dtype().kind not in "iu" or pred.header.get_data_dtype().kind not in "iu":
        raise ValueError("native original expert and model labelmaps must be integer, not probabilities")
    tp = fp = fn = pred_n = expert_n = 0
    lo = np.array(src.shape, dtype=int)
    hi = np.full(3, -1, dtype=int)
    for z in range(src.shape[2]):
        a = np.asarray(expert.dataobj[:,:,z])
        b = np.asarray(pred.dataobj[:,:,z])
        if (not np.isin(a,[0,1,2,3]).all()
                or not np.isin(b,[0,1]).all()):
            raise ValueError("unexpected label; expected expert KiTS23 label2 or original KS987 binary prediction label1")
        truth = a == 2
        result = b == 1
        t = int(np.count_nonzero(truth & result))
        p = int(np.count_nonzero(result))
        n = int(np.count_nonzero(truth))
        tp += t
        fp += p-t
        fn += n-t
        pred_n += p
        expert_n += n
        indices = np.argwhere(result)
        if len(indices):
            lo = np.minimum(lo,[indices[:,0].min(),indices[:,1].min(),z])
            hi = np.maximum(hi,[indices[:,0].max(),indices[:,1].max(),z])
    if expert_n != 7837:
        raise ValueError("admitted positive expert class2 count unexpectedly changed")
    dice = 2*tp/(2*tp+fp+fn)
    mm = src.header.get_xyzt_units()[0] == "mm"
    return {
        "schema":"opus-kits23-original-renal-tumor-voxel-metrics/v1",
        "publicResearchCase":"KiTS23 case_00021",
        "sourceCTSha256":CT_SHA,
        "originalExpertSha256":EXPERT_SHA,
        "originalKS987CheckpointSha256":CHECKPOINT_SHA,
        "modelMaskSha256":sha256(paths[2]),
        "nativeSourceGeometryVerified":True,
        "originalExpertLabelId":2,
        "predictedTumorLabelId":1,
        "expertTumorVoxels":expert_n,
        "predictedTumorVoxels":pred_n,
        "voxelTP":tp,"voxelFP":fp,"voxelFN":fn,
        "voxelDice":round(dice,9),
        "voxelRecall":round(tp/expert_n,9),
        "predictedNativeVoxelBoundsInclusive":[lo.tolist(),hi.tolist()] if pred_n else None,
        "predictedTumorVolumeMl":round(pred_n*abs(float(np.linalg.det(src.affine[:3,:3])))/1000,5) if mm else None,
        "originalModelForwardNotEstablishedByScorer":True,
        "expertMasksNeverFedToModel":True,
        "independentHoldoutVerified":False,
        "clinicalValidation":False,
        "noImagePixelsOrMasksInReport":True,
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for v in ("source","expert","prediction","checkpoint","output"):
        p.add_argument("--"+v,required=True,type=Path)
    a=p.parse_args()
    try:
        result=score(a.source,a.expert,a.prediction,checkpoint_path=a.checkpoint)
        if a.output.exists():
            raise ValueError("numeric output already exists")
        a.output.write_text(json.dumps(result,indent=2)+"\n",encoding="utf8")
        print(json.dumps({k:result[k] for k in ("voxelTP","voxelFP","voxelFN","voxelDice","clinicalValidation")}))
        return 0
    except (ValueError,OSError,ImportError) as e:
        print("Real renal tumor scoring rejected: "+str(e),file=sys.stderr)
        return 1


if __name__=="__main__":
    raise SystemExit(main())
