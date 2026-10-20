#!/usr/bin/env python3
"""Admit one genuinely annotated public contrast-enhanced T1 brain-metastasis MRI.

This is *source verification*, not QTIM's pretrained TensorFlow forward.
BEAMSTER images are CT-planning-space / defaced, not QTIM-preprocessed.
Only numeric evidence may leave this research worker. No image artifacts.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REPO = "MedOtter/BEAMSTER"
CASE = "Dataset_A_001"
IMAGE = f"dataset/Dataset_A/{CASE}.nii.gz"
EXPERT = f"dataset/Dataset_A/{CASE}_segm.nii.gz"
MAX_FILE_BYTES = 90 * 1024**2
MAX_VOXELS = 100_000_000


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as inp:
        for part in iter(lambda: inp.read(1024 * 1024), b""):
            sha.update(part)
    return sha.hexdigest()


def verify(image: Path, expert: Path) -> dict:
    import numpy as np
    import nibabel as nib

    mri = nib.load(str(image))
    gt = nib.load(str(expert))
    if (len(mri.shape) != 3 or mri.shape != gt.shape
            or np.prod(mri.shape, dtype=np.int64) > MAX_VOXELS
            or min(mri.shape) < 32):
        raise ValueError("original_BEAMSTER_image_expert_shape_invalid")
    if (not np.isfinite(mri.affine).all()
            or not np.allclose(mri.affine, gt.affine, atol=0.02, rtol=0)
            or not np.allclose(mri.affine[3], (0, 0, 0, 1), atol=1e-5)):
        raise ValueError("original_BEAMSTER_MRI_expert_affine_mismatch")
    spacing = np.linalg.norm(mri.affine[:3, :3], axis=0)
    if np.any(spacing < 0.3) or np.any(spacing > 5.0):
        raise ValueError("original_BEAMSTER_MRI_unreasonable_spacing")
    # A bounded single 3-D array is intentional on an isolated hosted worker.
    # Do not copy MRI bytes, slices or header metadata into the report.
    vox = np.asarray(mri.dataobj)
    if not np.isfinite(vox).all() or not np.any(vox != 0):
        raise ValueError("original_BEAMSTER_MRI_not_finite_nonempty")
    del vox
    truth = np.asarray(gt.dataobj)
    if not np.isfinite(truth).all() or not np.isin(truth, (0, 1)).all():
        raise ValueError("original_BEAMSTER_expert_binary_ontology_invalid")
    positive = int(np.count_nonzero(truth == 1))
    if positive == 0:
        raise ValueError("original_BEAMSTER_expert_mask_no_metastasis")
    volume_mm3 = abs(float(np.linalg.det(mri.affine[:3, :3])))
    return {
        "originalImageShape": list(mri.shape),
        "originalVoxelVolumeMm3": round(volume_mm3, 8),
        "originalExpertPositiveVoxels": positive,
        "originalExpertPositiveVolumeMl": round(positive * volume_mm3 / 1000, 6),
        "imageExpertSamePlanningGrid": True,
        "expertMaskBinaryOntologyVerified": True,
        "sourceImageSHA256": digest(image),
        "expertMaskSHA256": digest(expert),
    }


def execute() -> dict:
    from huggingface_hub import dataset_info, hf_hub_download

    info = dataset_info(REPO, files_metadata=True, token=False)
    if not info.sha or len(info.sha) != 40:
        raise ValueError("unversioned_BEAMSTER_dataset")
    published = {s.rfilename: s for s in info.siblings}
    paths = {}
    for name, key in ((IMAGE, "image"), (EXPERT, "expert")):
        item = published.get(name)
        if item is None or not item.size or not 100 <= item.size <= MAX_FILE_BYTES:
            raise ValueError("original_BEAMSTER_missing_or_unbounded_file")
        path = Path(hf_hub_download(
            repo_id=REPO, repo_type="dataset", filename=name,
            revision=info.sha, token=False,
        ))
        if path.stat().st_size != item.size:
            raise ValueError("BEAMSTER_published_size_mismatch")
        lfs = getattr(item, "lfs", None)
        if lfs and lfs.get("sha256") and digest(path) != lfs["sha256"]:
            raise ValueError("original_BEAMSTER_publisher_SHA256_mismatch")
        paths[key] = path
    checked = verify(paths["image"], paths["expert"])
    return {
        "schema": "opus-real-BEAMSTER-public-t1ce-expert-admission/v1",
        "dataset": REPO, "datasetRevision": info.sha,
        "case": CASE, "sourceImageRelativePath": IMAGE,
        "sourceExpertRelativePath": EXPERT,
        "claimedSourceLicense": "CC BY 4.0 (Figshare 10.6084/m9.figshare.29365844 v1)",
        "sourcePublication": "https://doi.org/10.1038/s41597-026-07777-0",
        "imageSequenceFromPublisher": "T1-weighted post-contrast 3D MPRAGE",
        "sourceVolumeIsCTPlanningSpaceAndDefaced": True,
        "rawAcquisitionToPlanningGridVerified": False,
        "qtimRequiredSkullStripN4RegistrationZNormalizationVerified": False,
        "qtimPublisherPretrainedModelForwardCompleted": False,
        "independenceFromQTIMTrainingVerified": False,
        "allVisibleMetastasesIndependentlyAnnotated": False,
        "clinicalValidation": False,
        "patientCloudTransfer": False,
        **checked,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True, type=Path)
    args = parser.parse_args()
    if args.report.exists() or args.report.is_symlink() or not args.report.parent.is_dir():
        parser.error("fresh_numeric_report_path_required")
    result = execute()
    args.report.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({
        "genuinePublicCE_T1": True,
        "verifiedExpertMetastaticVoxels": result["originalExpertPositiveVoxels"],
        "sourceImageSHA256": result["sourceImageSHA256"],
        "qtimOriginalModelForward": False,
        "independentValidation": False,
    }))


if __name__ == "__main__":
    main()
