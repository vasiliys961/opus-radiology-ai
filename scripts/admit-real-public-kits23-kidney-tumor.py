#!/usr/bin/env python3
"""Fetch ONE original noncommercial public KiTS23 expert-positive renal tumor CT.

Only numeric source/expert evidence is published. Source CT and original expert
segmentation remain in temporary PRIVATE runner storage, not GitHub artifacts.
No pretrained model inference; no patient upload; NO independent holdout claim.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import sys

DATASET = "MedOtter/kits23"
CASE = "case_00021"
ORIGINAL_CT = "dataset/case_00021/imaging.nii.gz"
ORIGINAL_MASK = "dataset/case_00021/segmentation.nii.gz"
# The ORIGINAL publicly published LFS SHA256 objects from publisher's dataset mirror.
ORIGINAL_CT_SHA256 = "c8fc76065ce316d6935c3dc87490606381d19fbff1bdd43616814e0cde0c0637"
ORIGINAL_MASK_SHA256 = "0292f2683b376043f478788624a8fdd924ce736c98626378fb897d4723991b50"
ORIGINAL_LFS_GIT_COMMIT = "3ddf82e740fbf40f5ca609762be4ba426335d8e7"
LABELS = {0: "background", 1: "kidney", 2: "renal_tumor", 3: "renal_cyst"}
MAX_SHAPE_VOXELS = 230_000_000


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(2**20), b""):
            digest.update(block)
    return digest.hexdigest()


def audit_pair(ct_file, expert_file):
    import nibabel as nib
    import numpy as np

    for item in (ct_file, expert_file):
        if item.is_symlink() or not item.is_file() or not 128 < item.stat().st_size < 650*1024**2:
            raise ValueError("original public NIfTI missing or exceeds safe research bound")
    ct, seg = nib.load(str(ct_file)), nib.load(str(expert_file))
    if (ct.ndim != 3 or seg.ndim != 3 or ct.shape != seg.shape
            or math.prod(ct.shape) > MAX_SHAPE_VOXELS or min(ct.shape) < 8
            or max(ct.shape) > 2048):
        raise ValueError("original CT and manual KiTS23 labels not equal bounded native 3D grids")
    if (not np.isfinite(ct.affine).all() or not np.isfinite(seg.affine).all()
            or abs(float(np.linalg.det(ct.affine[:3,:3]))) < 1e-8
            or not np.allclose(ct.affine, seg.affine, rtol=0, atol=1e-4)):
        raise ValueError("expert tumor mask and CT original affine physical grids differ")
    ct_unit, expert_unit = ct.header.get_xyzt_units()[0], seg.header.get_xyzt_units()[0]
    if ct_unit != expert_unit:
        raise ValueError("original CT and expert spatial units mismatch")
    if seg.header.get_data_dtype().kind not in "iu":
        raise ValueError("expert reference must be an original integer label image")

    counts = {i: 0 for i in LABELS}
    lo = np.array(ct.shape, dtype=np.int64)
    hi = np.full(3, -1, dtype=np.int64)
    center_sum = np.zeros(3, dtype=np.float64)
    min_ct, max_ct = float("inf"), -float("inf")
    for z in range(ct.shape[2]):
        src = np.asarray(ct.dataobj[:, :, z], dtype=np.float32)
        ann = np.asarray(seg.dataobj[:, :, z])
        if not np.isfinite(src).all() or not np.isfinite(ann).all():
            raise ValueError("source CT or expert mask contains nonfinite voxels")
        labels, amounts = np.unique(ann, return_counts=True)
        if any(int(v) not in LABELS or v != int(v) for v in labels):
            raise ValueError("unknown KiTS23 source annotation class")
        for ident, size in zip(labels, amounts):
            counts[int(ident)] += int(size)
        min_ct = min(min_ct, float(src.min()))
        max_ct = max(max_ct, float(src.max()))
        positive = np.argwhere(ann == 2)  # CLASS 2 = EXPERT TUMOR, not kidney/cyst
        if len(positive):
            n = len(positive)
            bounds_low = [int(positive[:,0].min()),int(positive[:,1].min()),z]
            bounds_high = [int(positive[:,0].max()),int(positive[:,1].max()),z]
            lo = np.minimum(lo, bounds_low)
            hi = np.maximum(hi, bounds_high)
            center_sum += [float(positive[:, 0].sum()), float(positive[:, 1].sum()), float(z*n)]
    if counts[2] < 1:
        raise ValueError("NO POSITIVE expert renal tumor label 2 observed")
    if (min_ct < -3500 or max_ct > 15000
            or min_ct > -250 or max_ct < 50):
        raise ValueError("public study intensity not plausible original CT HU")
    centroid = center_sum / counts[2]
    volume_mm3 = float(abs(np.linalg.det(ct.affine[:3, :3])))
    ras_center = (ct.affine @ np.array([*centroid, 1]))[:3]
    mm = ct_unit == "mm"
    return {
        "schema": "opus-kits23-genuine-positive-native-renal-tumor/v1",
        "dataset": "KiTS23", "sourceMirror": DATASET,
        "publicResearchCase": CASE,
        "sourceShape": list(ct.shape),
        "nativeSourceAndExpertGridVerified": True,
        "nativeSourceSpatialUnits": ct_unit or "unknown",
        "physicalVolumeSuppressedWhenOriginalMmUnknown": not mm,
        "observedExpertClassVoxels": {str(i): counts[i] for i in LABELS},
        "originalAuthorKiTS23TumorClassId": 2,
        "expertTumorPositive": counts[2] > 0,
        "expertTumorVoxelCount": counts[2],
        "expertTumorNativeVoxelBoundsInclusive": [lo.tolist(), hi.tolist()],
        "expertTumorNativeVoxelCentroid": [round(float(v), 3) for v in centroid],
        "expertTumorNativeRasMmCentroid": [round(float(v), 3) for v in ras_center] if mm else None,
        "expertTumorVolumeMl": round(counts[2] * volume_mm3 / 1000, 5) if mm else None,
        "sourceHuRangeObserved": [min_ct, max_ct],
        "tumorIsNotBackgroundKidneyOrCyst": True,
        "expertMaskNotGivenToTrainedModel": True,
        "originalCancerModelForwardCompleted": False,
        "publishedModelMayOverlapSourceTraining": True,
        "independentClinicalValidation": False,
        "clinicalPatientUse": False,
    }


def fetch_pair(directory):
    from huggingface_hub import HfApi, hf_hub_download
    if directory.exists():
        raise ValueError("public source directory already exists; no stale case")
    info = HfApi(token=False).repo_info(DATASET, repo_type="dataset",
                                         revision=ORIGINAL_LFS_GIT_COMMIT, token=False)
    if info.sha != ORIGINAL_LFS_GIT_COMMIT:
        raise ValueError("original publisher mirror immutable revision mismatch")
    names = {s.rfilename for s in info.siblings}
    if ORIGINAL_CT not in names or ORIGINAL_MASK not in names:
        raise ValueError("original KiTS23 CT and expert pair absent in pinned dataset")
    downloaded = {
        "ct": Path(hf_hub_download(repo_id=DATASET, filename=ORIGINAL_CT,
                                  repo_type="dataset", revision=info.sha, token=False)),
        "mask": Path(hf_hub_download(repo_id=DATASET, filename=ORIGINAL_MASK,
                                    repo_type="dataset", revision=info.sha, token=False)),
    }
    for key, expected in (("ct", ORIGINAL_CT_SHA256), ("mask", ORIGINAL_MASK_SHA256)):
        observed = sha256(downloaded[key])
        if observed != expected:
            raise ValueError("actual KiTS23 "+key+" LFS mismatch: observed_sha256="+observed+
                             " expected_sha256="+expected+
                             " observed_bytes="+str(downloaded[key].stat().st_size))
    directory.mkdir(mode=0o700, parents=True)
    (directory / "in").mkdir(mode=0o700)
    (directory / "expert_reference_private").mkdir(mode=0o700)
    source = directory / "in" / "renalcase001_0000.nii.gz"
    expert = directory / "expert_reference_private" / "renalcase001_expert.nii.gz"
    shutil.copyfile(downloaded["ct"], source)
    shutil.copyfile(downloaded["mask"], expert)
    record = audit_pair(source, expert)
    if sha256(source) != ORIGINAL_CT_SHA256 or sha256(expert) != ORIGINAL_MASK_SHA256:
        raise ValueError("source copy corrupted")
    record.update({
        "datasetMirrorGitRevision": ORIGINAL_LFS_GIT_COMMIT,
        "originalCTSha256": ORIGINAL_CT_SHA256,
        "originalManualExpertSegmentationSha256": ORIGINAL_MASK_SHA256,
        "originalDownloadedDataRights": "CC BY-NC-SA 4.0 as declared by KiTS23 mirror; research-only",
        "originalLfsFilePaths": {"source": ORIGINAL_CT, "expertReference": ORIGINAL_MASK},
        "sourceMayOverlapKS987OriginalTraining": True,
        "noExpertDiceWithoutRealModelInference": True,
    })
    (directory / "numeric-original-renal-tumor-evidence.json").write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    return record


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--output-private", type=Path, required=True)
    p.add_argument("--execute-original-public-download", action="store_true")
    a = p.parse_args()
    if not a.execute_original_public_download:
        print("Opt-in public-only KiTS23 study not downloaded; no inference.")
        return 0
    try:
        result = fetch_pair(a.output_private.expanduser().resolve())
        print(json.dumps({
            "case": result["publicResearchCase"],
            "originalCTSha256": result["originalCTSha256"],
            "expertTumorPositive": result["expertTumorPositive"],
            "expertTumorVoxelCount": result["expertTumorVoxelCount"],
            "independentClinicalValidation": False}, ensure_ascii=False))
        return 0
    except (OSError, ValueError, RuntimeError, ImportError) as exc:
        print("Original KiTS23 expert tumor public source rejected: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
