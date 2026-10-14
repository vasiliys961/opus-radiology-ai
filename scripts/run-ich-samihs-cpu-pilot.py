#!/usr/bin/env python3
"""Bounded, genuinely trained SAMIHS CPU research pilot on an authorized CT slab.

Never a substitute for the CUDA full-case runner. Uses original source voxels,
native affine, original expert-mask voxels, and the audited vendor wrapper.
Prepare-only mode DOES NOT run a model or compute Dice. No downloads, patient
uploads, network/API calls or model checkpoint deserialization in this script.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import time
from urllib.parse import urlparse

SAMIHS_SHA256 = "b4c5ff729b906605555f83359120341a72035d1b6a784a9fef7dd61ee09a639e"
SAMIHS_REVISION = "29aaa1287ca35b19e40495bd4966fa2923871cb9"
MODEL_CHECKPOINT = Path("weights/SAMIHS_09170527_2_0.483.pth")
MODEL_WRAPPER = "segment_ich.py"
SHA = re.compile(r"^[0-9a-f]{64}$")
SCHEMA = "opus-ich-samihs-bounded-cpu-pilot/v1"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def required_file(name: str, max_bytes: int = 512 * 1024 * 1024) -> Path:
    p = Path(name)
    if p.is_symlink() or not p.is_file() or not 0 < p.stat().st_size <= max_bytes:
        raise ValueError("bounded_regular_source_file_required")
    return p.resolve()


def admission(args) -> tuple[Path, Path, Path]:
    if sys.platform == "darwin":
        raise ValueError("external_linux_cpu_only_not_mac")
    if (args.authorization != "AUTHORIZED-PUBLIC-ICH-CPU-SLAB"
            or not args.rights_attested or not args.deidentified_public_data):
        raise ValueError("authorized_public_nonpatient_dataset_required")
    citation = urlparse(args.dataset_citation_url)
    if (citation.scheme != "https" or not citation.hostname or citation.username
            or citation.password or citation.query or citation.fragment
            or len(args.dataset_citation_url) > 512
            or citation.hostname in ("localhost", "127.0.0.1")):
        raise ValueError("dataset_citation_must_be_plain_https")
    if args.slice_axis != 2 or args.slice_count not in (16, 32):
        raise ValueError("native_k_axis_and_16_or_32_slices_required")
    if args.start_slice < 0 or not 1 <= args.reference_label <= 65535:
        raise ValueError("invalid_source_slice_or_reference_label")
    if args.timeout_seconds < 120 or args.timeout_seconds > 1800:
        raise ValueError("bounded_cpu_inference_timeout_required")
    source = required_file(args.input)
    reference = required_file(args.expert_mask)
    if not (source.name.endswith((".nii", ".nii.gz"))
            and reference.name.endswith((".nii", ".nii.gz"))):
        raise ValueError("original_nifti_volume_and_expert_mask_required")
    if source == reference or sha256_file(source) != args.source_sha256 \
            or sha256_file(reference) != args.reference_sha256 \
            or not all(SHA.fullmatch(x) for x in (args.source_sha256, args.reference_sha256)):
        raise ValueError("original_source_and_expert_sha256_required")
    out = Path(args.output_dir)
    if out.exists() or out.is_symlink() or not out.parent.is_dir() or out.parent.is_symlink():
        raise ValueError("new_private_result_directory_required")
    if out.resolve() in (source, reference, source.parent, reference.parent):
        raise ValueError("results_must_be_isolated_from_source")
    if args.mode == "infer":
        if not args.upstream_model_audited or not args.model_dir:
            raise ValueError("independently_audited_upstream_model_required")
        if args.checkpoint_sha256 != SAMIHS_SHA256 or not SHA.fullmatch(args.wrapper_sha256):
            raise ValueError("official_samihs_checkpoint_and_wrapper_sha_required")
        model_dir = Path(args.model_dir)
        if model_dir.is_symlink() or not model_dir.is_dir():
            raise ValueError("installed_audited_model_directory_required")
        checkpoint = required_file(str(model_dir / MODEL_CHECKPOINT), 2 * 1024**3)
        wrapper = required_file(str(model_dir / MODEL_WRAPPER), 1024 * 1024)
        if (sha256_file(checkpoint) != SAMIHS_SHA256
                or sha256_file(wrapper) != args.wrapper_sha256):
            raise ValueError("trained_model_or_wrapper_sha_mismatch")
    return source, reference, out


def source_aligned_slab(source: Path, reference: Path, axis: int, start: int,
                        count: int, label: int):
    import nibabel as nib
    import numpy as np

    ct = nib.load(str(source))
    expert = nib.load(str(reference))
    if (ct.ndim != 3 or expert.ndim != 3 or ct.shape != expert.shape
            or ct.shape[0] < 16 or ct.shape[1] < 16
            or ct.shape[0] > 512 or ct.shape[1] > 512
            or ct.shape[2] > 400 or math.prod(ct.shape) > 512 * 512 * 400
            or start + count > ct.shape[axis]):
        raise ValueError("unsupported_real_3d_source_or_slice_span")
    if (ct.header.get_xyzt_units()[0] != "mm" or
            expert.header.get_xyzt_units()[0] != "mm" or
            int(ct.header["sform_code"]) <= 0 or
            int(expert.header["sform_code"]) <= 0 or
            not np.all(np.isfinite(ct.affine)) or
            not np.allclose(ct.affine, expert.affine, rtol=0, atol=0.05)):
        raise ValueError("original_ct_expert_native_mm_grid_mismatch")
    for volume in (ct, expert):
        if int(volume.header["qform_code"]) > 0 and not np.allclose(
                volume.get_qform(), volume.affine, rtol=0, atol=0.05):
            raise ValueError("source_sform_qform_conflict")
    if ct.header.get_data_dtype().kind not in "iuf":
        raise ValueError("unsupported_original_ct_pixel_type")
    if expert.header.get_data_dtype().kind not in "iu":
        raise ValueError("expert_mask_must_have_integer_labels")
    index = [slice(None)] * 3
    index[axis] = slice(start, start + count)
    raw_ct = np.asarray(ct.dataobj[tuple(index)])
    raw_labels = np.asarray(expert.dataobj[tuple(index)])
    if (not np.all(np.isfinite(raw_ct)) or not np.all(np.isfinite(raw_labels))
            or np.any(raw_labels < 0) or not np.any(raw_labels == label)
            or np.any(raw_labels != np.floor(raw_labels))):
        raise ValueError("source_intensities_or_positive_expert_labels_invalid")
    expert_binary = np.asarray(raw_labels == label, dtype=np.uint8)
    shift = np.eye(4)
    shift[axis, 3] = start
    affine = np.asarray(ct.affine, dtype=np.float64) @ shift

    def slab(array, original):
        header = original.header.copy()
        nii = nib.Nifti1Image(np.ascontiguousarray(array), affine, header=header)
        nii.set_sform(affine, code=int(original.header["sform_code"]))
        qcode = int(original.header["qform_code"])
        if qcode > 0:
            nii.set_qform(affine, code=qcode)
        else:
            nii.set_qform(affine, code=0)
        nii.header.set_xyzt_units(xyz="mm")
        return nii

    if abs(float(np.linalg.det(affine[:3, :3]))) < 0.001:
        raise ValueError("invalid_source_voxel_volume")
    return slab(raw_ct, ct), slab(expert_binary, expert), {
        "originalDimensions": list(ct.shape),
        "originalSliceStartK": start,
        "originalSliceStopExclusiveK": start + count,
        "sliceAxis": axis,
        "selectedSlices": count,
        "expertPositiveVoxelsInSlab": int(np.count_nonzero(expert_binary)),
        "originalExpertIsBinary": bool(np.all((raw_labels == 0) | (raw_labels == 1))),
        "voxelVolumeMl": abs(float(np.linalg.det(affine[:3, :3]))) / 1000,
    }


def run(args):
    source, reference, output = admission(args)
    import nibabel as nib
    import numpy as np

    slab_ct, slab_expert, coverage = source_aligned_slab(
        source, reference, args.slice_axis, args.start_slice,
        args.slice_count, args.reference_label)
    output.mkdir(mode=0o700)
    ct_path = output / "source-native-slab.nii.gz"
    expert_path = output / "expert-native-binary-slab.nii.gz"
    nib.save(slab_ct, str(ct_path))
    nib.save(slab_expert, str(expert_path))
    result = {
        "schema": SCHEMA,
        "status": "prepared_real_public_slab_no_model_execution",
        "fullOriginalStudyProcessed": False,
        "publicResearchRightsOperatorAttested": True,
        "citation": args.dataset_citation_url,
        "upstreamSamiHSRevision": SAMIHS_REVISION,
        "source": {
            "originalCtSha256": args.source_sha256,
            "originalExpertSha256": args.reference_sha256,
            "slabCtSha256": sha256_file(ct_path),
            "slabExpertSha256": sha256_file(expert_path),
            **coverage,
        },
        "model": {"executed": False, "device": None, "checkpointSha256": None},
        "metrics": None,
        "clinicalValidation": False,
        "limitations": [
            "Only a selected consecutive native K slab was processed.",
            "Preselecting a hemorrhage-positive slab biases performance upward.",
            "Not full-series recall, patient sensitivity, lesion detection or diagnosis.",
            "Source geometry is not linked to original DICOM SOP instances.",
        ],
    }
    if args.mode == "infer":
        mask_path = output / "samihs-cpu-slab-mask.nii.gz"
        command = [
            sys.executable, str((Path(args.model_dir) / MODEL_WRAPPER).resolve()),
            "--input", str(ct_path), "--output", str(mask_path),
            "--device", "cpu", "--batch-size", "1", "--threshold", "0.5",
            "--slice-axis", "2",
        ]
        start_time = time.monotonic()
        try:
            subprocess.run(
                command, cwd=str(Path(args.model_dir).resolve()), check=True,
                timeout=args.timeout_seconds,
                env={**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
                     "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"},
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            predicted = nib.load(str(required_file(str(mask_path))))
            if (predicted.shape != slab_ct.shape or predicted.header.get_data_dtype().kind not in "iu"
                    or not np.allclose(predicted.affine, slab_ct.affine, atol=0.05, rtol=0)):
                raise ValueError("trained_cpu_output_must_match_native_ct_slab")
            mask = np.asarray(predicted.dataobj)
            if not np.all((mask == 0) | (mask == 1)):
                raise ValueError("trained_cpu_output_must_be_binary")
            eval_path = Path(__file__).with_name("evaluate-ich-public-mask.py")
            spec = importlib.util.spec_from_file_location("ich_cpu_reference", eval_path)
            evaluator = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(evaluator)
            metrics = evaluator.segmentation_metrics(
                mask.astype(np.bool_), np.asarray(slab_expert.dataobj, dtype=np.bool_),
                coverage["voxelVolumeMl"], slab_ct.affine)
            result.update({
                "status": "trained_samihs_cpu_slab_executed_and_expert_compared",
                "model": {
                    "executed": True, "device": "cpu", "batchSize": 1,
                    "checkpointSha256": SAMIHS_SHA256,
                    "wrapperSha256": args.wrapper_sha256,
                    "actualModelExecutionSeconds": round(time.monotonic() - start_time, 2),
                },
                "predictionMaskSha256": sha256_file(mask_path),
                "metrics": metrics,
            })
        except Exception:
            mask_path.unlink(missing_ok=True)
            raise
    manifest = output / "opus-ich-samihs-cpu-slab.json"
    manifest.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=["prepare", "infer"], required=True)
    for field in ("input", "expert-mask", "output-dir", "source-sha256",
                  "reference-sha256", "dataset-citation-url", "authorization"):
        parser.add_argument("--" + field, required=True)
    parser.add_argument("--rights-attested", action="store_true")
    parser.add_argument("--deidentified-public-data", action="store_true")
    parser.add_argument("--slice-axis", type=int, default=2)
    parser.add_argument("--start-slice", type=int, required=True)
    parser.add_argument("--slice-count", type=int, choices=[16, 32], default=16)
    parser.add_argument("--reference-label", type=int, default=1)
    parser.add_argument("--timeout-seconds", type=int, default=1200)
    parser.add_argument("--model-dir")
    parser.add_argument("--checkpoint-sha256")
    parser.add_argument("--wrapper-sha256")
    parser.add_argument("--upstream-model-audited", action="store_true")
    args = parser.parse_args()
    try:
        result = run(args)
        print(json.dumps({
            "status": result["status"],
            "sourceSlices": result["source"]["selectedSlices"],
            "trainedModelExecuted": result["model"]["executed"],
            "dice": result["metrics"]["dice"] if result["metrics"] else None,
            "hd95Mm": result["metrics"]["hd95Mm"] if result["metrics"] else None,
            "fullOriginalStudyProcessed": False,
        }))
    except Exception as error:
        print("ICH bounded CPU pilot failed: " + type(error).__name__ + ": " +
              str(error).split("/")[0][:100], file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
