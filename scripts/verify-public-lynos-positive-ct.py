#!/usr/bin/env python3
"""Admit original public expert-positive LyNoS contrast CT without model claims.

Download exactly named original CT+manual lymph node NIfTI at one immutable
dataset revision, verify available publisher LFS SHA, original physical grid,
positive expert labels, and publish *numbers/hashes only*.
No pixel, NIfTI, demographics or patient content in CI artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

DATASET = "andreped/LyNoS"
CT = "Pat3/pat3_data.nii.gz"
EXPERT = "Pat3/pat3_labels_LymphNodes.nii.gz"
EXPECTED_SOURCE_SHA256 = "d918d73688c38be7550a59e881e6a72b617f4d8f4171e99b286afb89f27ce646"
MAX_FILE_BYTES = 320 * 1024**2
MAX_VOXELS = 260_000_000


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_pair(original: Path, annotation: Path) -> dict:
    import numpy as np
    import nibabel as nib

    ct = nib.load(str(original))
    mask = nib.load(str(annotation))
    if (len(ct.shape) != 3 or ct.shape != mask.shape or min(ct.shape) < 32
            or np.prod(ct.shape, dtype=np.int64) > MAX_VOXELS):
        raise ValueError("LyNoS_public_original_CT_expert_shape_invalid")
    if (not np.isfinite(ct.affine).all()
            or not np.allclose(ct.affine, mask.affine, atol=.03, rtol=0)
            or not np.allclose(ct.affine[3], (0, 0, 0, 1), atol=1e-5)):
        raise ValueError("LyNoS_public_original_CT_expert_affine_mismatch")
    pitch = np.linalg.norm(ct.affine[:3, :3], axis=0)
    if np.any(pitch < .2) or np.any(pitch > 6):
        raise ValueError("LyNoS_CT_unreasonable_voxel_spacing")
    # Read three CT slabs only: original CT bytes remain private and evaluation
    # does not need to decompress and store a huge 3D CT in memory.
    for z in (0, ct.shape[2] // 2, ct.shape[2] - 1):
        sample = np.asarray(ct.dataobj[:, :, z])
        if not np.isfinite(sample).all():
            raise ValueError("LyNoS_CT_contains_nonfinite_sampled_pixels")
    positive = 0
    labels = set()
    for z in range(mask.shape[2]):
        slab = np.asarray(mask.dataobj[:, :, z])
        if (not np.isfinite(slab).all() or (slab < 0).any()
                or (slab > 4096).any() or not np.equal(slab, np.floor(slab)).all()):
            raise ValueError("LyNoS_expert_instance_label_ontology_invalid")
        positive += int(np.count_nonzero(slab > 0))
        labels.update(int(v) for v in np.unique(slab) if v > 0)
        if len(labels) > 4096:
            raise ValueError("LyNoS_expert_instance_labels_unbounded")
    if positive == 0:
        raise ValueError("LyNoS_expert_positive_lymph_nodes_required")
    vox_ml = abs(float(np.linalg.det(ct.affine[:3, :3]))) / 1000
    return {
        "originalShape": list(ct.shape),
        "sourceCTSHA256": sha256(original),
        "expertLabelSHA256": sha256(annotation),
        "nativePhysicalCTExpertGridMatches": True,
        "expertPositiveVoxels": positive,
        "expertLabeledVolumeMl": round(positive * vox_ml, 5),
        "expertDistinctNonzeroLabelValues": len(labels),
        "distinctLabelValuesDoNotNecessarilyEqualNodes": True,
        "voxelVolumeMm3": round(vox_ml * 1000, 8),
    }


def execute() -> dict:
    from huggingface_hub import dataset_info, hf_hub_download

    info = dataset_info(DATASET, files_metadata=True, token=False)
    if not info.sha or len(info.sha) != 40:
        raise ValueError("LyNoS_public_dataset_revision_not_pinned")
    assets = {entry.rfilename: entry for entry in info.siblings}
    files = {}
    for filename, role in ((CT, "ct"), (EXPERT, "annotation")):
        entry = assets.get(filename)
        if entry is None or not entry.size or not 100 <= entry.size <= MAX_FILE_BYTES:
            raise ValueError("LyNoS_original_public_source_file_missing_or_unbounded")
        path = Path(hf_hub_download(
            repo_id=DATASET, repo_type="dataset", filename=filename,
            revision=info.sha, token=False))
        if path.stat().st_size != entry.size:
            raise ValueError("LyNoS_public_download_size_mismatch")
        reported_lfs = getattr(entry, "lfs", None)
        if reported_lfs and reported_lfs.get("sha256"):
            if sha256(path) != reported_lfs["sha256"]:
                raise ValueError("LyNoS_original_public_LFS_SHA256_mismatch")
        files[role] = path
    actual = verify_pair(files["ct"], files["annotation"])
    if actual["sourceCTSHA256"] != EXPECTED_SOURCE_SHA256:
        raise ValueError("LyNoS_CT_original_publisher_SHA256_changed")
    return {
        "schema": "opus-real-public-LyNoS-contrast-CT-manual-node-mask/v1",
        "dataset": DATASET,
        "caseReference": "Pat3",
        "datasetImmutableRevision": info.sha,
        "originalCTRelativePath": CT,
        "originalExpertRelativePath": EXPERT,
        "reportedHubLicense": "MIT (dataset card; original patient data rights require separate clearance)",
        "researchOnly": True,
        "modelTrainedForwardCompleted": False,
        "independentModelTrainingExclusionVerified": False,
        "expertReferenceIsNotModelPrediction": True,
        "malignancyClassified": False,
        "clinicallyValidated": False,
        "patientCloudTransfer": False,
        **actual,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--report", type=Path, required=True)
    args = p.parse_args()
    if args.report.exists() or args.report.is_symlink() or not args.report.parent.is_dir():
        p.error("new_private_numeric_report_file_required")
    result = execute()
    args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({
        "actualPublicContrastCT": True,
        "expertPositiveVoxels": result["expertPositiveVoxels"],
        "sourceCTSHA256": result["sourceCTSHA256"],
        "trainedModelForward": False,
        "clinicalValidation": False,
    }))


if __name__ == "__main__":
    main()
