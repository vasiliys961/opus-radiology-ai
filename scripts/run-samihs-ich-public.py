#!/usr/bin/env python3
"""Opt-in SAMIHS trained ICH segmentation on an externally vetted PUBLIC brain CT.

Research only: executes locally installed upstream segment_ich.py and authentic
trained checkpoint, never downloads input or weights, never touches the R231
worker or sends patient data to CI. Head CT source -> binary predicted mask and
source-bound lesion candidate metadata. No diagnosis or negative conclusion.

Requirements for running: externally provisioned GPU, audited SAMIHS code,
verified source data/license, nibabel, numpy, scipy, torch in isolated env.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

CHECKPOINT_REL = Path("weights/SAMIHS_09170527_2_0.483.pth")
WRAPPER_REL = Path("segment_ich.py")
REPORT_SCHEMA = "opus-ich-samihs-public-research/v1"
MAX_SOURCE_BYTES = 512 * 1024 * 1024
MAX_VOXELS = 512 * 512 * 400
MAX_COMPONENTS = 128


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def valid_sha(value: str, field: str) -> str:
    if not isinstance(value, str) or len(value) != 64 or any(
        c not in "0123456789abcdef" for c in value
    ):
        raise ValueError("missing_or_invalid_" + field + "_sha256")
    return value


def regular_file(path: Path, max_bytes: int | None = None) -> Path:
    if path.is_symlink() or not path.is_file():
        raise ValueError("missing_or_symlink_input")
    if max_bytes is not None and not 0 < path.stat().st_size <= max_bytes:
        raise ValueError("unsafe_source_size")
    return path.resolve()


def source_header(path: Path, slice_axis: int) -> dict:
    import nibabel as nib
    import numpy as np

    image = nib.load(str(path))
    if image.header.get_xyzt_units()[0] != "mm":
        raise ValueError("nifti_spatial_units_must_be_mm_for_volume_measurement")
    if int(image.header["sform_code"]) <= 0:
        raise ValueError("sform_required_for_source_grid_verification")
    shape = image.shape
    if len(shape) != 3 or any(
        type(x) not in (int, np.int64, np.int32) or x < 16 or x > 512 for x in shape
    ) or math.prod(shape) > MAX_VOXELS or shape[slice_axis] > 400:
        raise ValueError("unsupported_3d_ct_shape")
    affine = np.asarray(image.affine, dtype=np.float64)
    if affine.shape != (4, 4) or not np.all(np.isfinite(affine)) or not np.allclose(
        affine[3, :], [0, 0, 0, 1], atol=1e-5
    ):
        raise ValueError("invalid_nifti_affine")
    determinant = float(np.linalg.det(affine[:3, :3]))
    voxel_ml = abs(determinant) / 1000.0
    if not 0.000001 <= voxel_ml <= 1.0:
        raise ValueError("implausible_voxel_volume")
    if image.header.get_data_dtype().kind not in ("i", "u", "f"):
        raise ValueError("unsupported_nifti_pixel_type")
    return {
        "dimensions": [int(x) for x in shape],
        "affineRas": affine.tolist(),
        "voxelVolumeMl": voxel_ml,
        "sliceAxis": slice_axis,
    }


def summarize_prediction(source: Path, mask_path: Path, geometry: dict) -> dict:
    """No anatomical subtype is inferred from a single binary SAMIHS mask."""
    import nibabel as nib
    import numpy as np
    from scipy import ndimage

    mask_nii = nib.load(str(mask_path))
    source_nii = nib.load(str(source))
    if mask_nii.header.get_xyzt_units()[0] != "mm":
        raise ValueError("predicted_mask_spatial_units_not_mm")
    if mask_nii.ndim != 3 or list(mask_nii.shape) != geometry["dimensions"]:
        raise ValueError("mask_shape_not_bound_to_original_ct")
    if not np.allclose(mask_nii.affine, source_nii.affine, rtol=0, atol=1e-4):
        raise ValueError("mask_affine_differs_from_original_ct")
    if mask_nii.header.get_data_dtype() != np.dtype("uint8"):
        raise ValueError("mask_must_be_uint8_labelmap")
    mask = np.asanyarray(mask_nii.dataobj)
    if mask.shape != tuple(geometry["dimensions"]) or np.any((mask != 0) & (mask != 1)):
        raise ValueError("nonbinary_prediction_mask")
    # Connected components in index space: 6-neighbor 3D connectivity.
    # NOT a radiologist-confirmed count of individual hematomas.
    labels, n_components = ndimage.label(mask)
    if n_components > 100000:
        raise ValueError("unreasonable_component_count")
    objects = ndimage.find_objects(labels)
    components = []
    for idx, box in enumerate(objects):
        if box is None:
            continue
        cropped = labels[box]
        voxels = int(np.count_nonzero(cropped == idx + 1))
        if voxels == 0:
            continue
        low = [int(x.start) for x in box]
        high = [int(x.stop - 1) for x in box]
        components.append({
            "componentIndex": idx,
            "voxelCount": voxels,
            "volumeMl": round(voxels * geometry["voxelVolumeMl"], 5),
            "boundsVoxelMin": low,
            "boundsVoxelMax": high,
            "modelProbabilityCalibrated": False,
            "clinicianVerified": False,
        })
    components.sort(key=lambda x: (-x["voxelCount"], x["componentIndex"]))
    all_voxels = int(np.count_nonzero(mask))
    result = {
        "predictedPositiveVoxelCount": all_voxels,
        "predictedMaskVolumeMl": round(all_voxels * geometry["voxelVolumeMl"], 5),
        "connectedComponentsTotal": len(components),
        "largestComponents": components[:MAX_COMPONENTS],
        "componentListTruncated": len(components) > MAX_COMPONENTS,
        "detectionStatus": "candidates_from_binary_mask" if all_voxels else "no_mask_candidate_not_a_negative_diagnosis",
        "ichSubtype": None,
        "negativeDiagnosisPermitted": False,
    }
    del labels
    return result


def execute(args: argparse.Namespace) -> dict:
    if args.public_research_authorization != "PUBLIC-ICH-RESEARCH-ONLY":
        raise ValueError("explicit_public_data_authorization_required")
    if args.device != "cuda:0":
        raise ValueError("research_gpu_cuda0_only_no_mac_m1_execution")
    if args.slice_axis not in (0, 1, 2) or args.batch_size not in (1, 2, 4, 8):
        raise ValueError("explicit_slice_axis_and_bounded_batch_required")
    if not 0.05 <= args.threshold <= 0.95:
        raise ValueError("invalid_threshold")
    model_dir = Path(args.model_dir)
    if model_dir.is_symlink() or not model_dir.is_dir():
        raise ValueError("invalid_model_directory")
    checkpoint = regular_file(model_dir / CHECKPOINT_REL)
    wrapper = regular_file(model_dir / WRAPPER_REL, 1024 * 1024)
    source = regular_file(Path(args.input), MAX_SOURCE_BYTES)
    if not source.name.endswith((".nii", ".nii.gz")):
        raise ValueError("3d_nifti_required")
    output_dir = Path(args.output_dir)
    if output_dir.exists() or output_dir.is_symlink():
        raise ValueError("output_directory_must_not_exist")
    if not output_dir.parent.is_dir() or output_dir.parent.is_symlink():
        raise ValueError("output_parent_must_be_existing_regular_directory")
    if output_dir.resolve() == model_dir.resolve() or output_dir.resolve() == source.parent:
        raise ValueError("output_must_be_isolated")
    for file, expected, field in (
        (checkpoint, args.checkpoint_sha256, "checkpoint"),
        (wrapper, args.wrapper_sha256, "wrapper"),
        (source, args.source_sha256, "source"),
    ):
        if sha256_file(file) != valid_sha(expected, field):
            raise ValueError(field + "_sha256_mismatch")
    geometry = source_header(source, args.slice_axis)
    import torch
    if not torch.cuda.is_available() or torch.cuda.device_count() < 1:
        raise ValueError("dedicated_cuda_gpu_required")
    total_vram = int(torch.cuda.get_device_properties(0).total_memory)
    if total_vram < 12 * 1024**3:
        raise ValueError("gpu_vram_under_12_gib_unverified_for_this_model")
    output_dir.mkdir(parents=True, mode=0o700, exist_ok=False)
    mask_path = output_dir / "samihs-public-ich-mask.nii.gz"
    command = [
        sys.executable, str(wrapper),
        "--input", str(source), "--output", str(mask_path),
        "--device", "cuda:0", "--batch-size", str(args.batch_size),
        "--threshold", str(args.threshold), "--slice-axis", str(args.slice_axis),
    ]
    started = time.monotonic()
    try:
        subprocess.run(
            command, cwd=str(model_dir.resolve()), check=True,
            timeout=args.timeout_seconds,
            env={**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"},
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        mask_path = regular_file(mask_path, MAX_SOURCE_BYTES)
        candidate = summarize_prediction(source, mask_path, geometry)
        report = {
            "schema": REPORT_SCHEMA,
            "researchStatus": "trained_upstream_adapter_executed_public_only",
            "model": {
                "id": "samihs-ich-binary-ct",
                "origin": "MooreMuaMu/samihs-ich-segmentation",
                "version": "user-audited-local-checkpoint",
                "checkpointSha256": sha256_file(checkpoint),
                "wrapperSha256": sha256_file(wrapper),
                "modelWeightsUsed": True,
                "licenseClaim": "MIT model card; dependencies and weight provenance require independent review",
            },
            "source": {
                "format": "3d-nifti",
                "sha256": sha256_file(source),
                "fullVolumeProcessed": True,
                "sourceDicomSopBound": False,
                "patientData": False,
                "geometry": geometry,
            },
            "prediction": {
                **candidate,
                "maskSha256": sha256_file(mask_path),
                "maskFormat": "3d-binary-nifti-uint8",
                "thresholdUncalibrated": args.threshold,
            },
            "execution": {
                "device": args.device,
                "batchSize": args.batch_size,
                "seconds": round(time.monotonic() - started, 2),
            },
            "validation": {
                "independentDice": None,
                "sensitivity": None,
                "specificity": None,
                "externalCohortEvaluated": False,
                "clinicalValidation": False,
                "physicianReviewRequired": True,
            },
            "limitations": [
                "Binary suspected hemorrhage segmentation; not subtype classification.",
                "NIfTI RAS coordinate mapping to original DICOM SOP is not verified.",
                "Mask predicted voxels are not radiologist confirmed hemorrhages.",
                "No predicted positives never means absence of intracranial hemorrhage.",
                "Public research only; no automatic patient processing or cloud upload.",
            ],
        }
        report_path = output_dir / "opus-ich-samihs-public-report.json"
        report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        return report
    except Exception:
        # Fail closed: no partial mask should look like a completed inference.
        mask_path.unlink(missing_ok=True)
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--checkpoint-sha256", required=True)
    parser.add_argument("--wrapper-sha256", required=True)
    parser.add_argument("--source-sha256", required=True)
    parser.add_argument("--slice-axis", type=int, choices=[0, 1, 2], required=True)
    parser.add_argument("--batch-size", type=int, choices=[1, 2, 4, 8], default=1)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    parser.add_argument("--public-research-authorization", required=True)
    args = parser.parse_args()
    if not 60 <= args.timeout_seconds <= 7200:
        parser.error("timeout must be 60-7200 seconds")
    try:
        result = execute(args)
        print(json.dumps({
            "status": result["researchStatus"],
            "maskVoxelCandidates": result["prediction"]["predictedPositiveVoxelCount"],
            "reportWritten": True,
            "clinicalValidated": False,
        }, ensure_ascii=False))
    except Exception as error:
        # No local paths, study names or sensitive model logs in stdout/CI.
        print("SAMIHS public research failed: " + type(error).__name__ + ": " +
              str(error).split("/")[0][:160], file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
