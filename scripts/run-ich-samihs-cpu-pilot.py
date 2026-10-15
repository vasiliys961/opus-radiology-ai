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
import tempfile
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
    if (source == reference
            or not all(isinstance(x, str) and SHA.fullmatch(x)
                       for x in (args.source_sha256, args.reference_sha256))
            or sha256_file(source) != args.source_sha256
            or sha256_file(reference) != args.reference_sha256):
        raise ValueError("original_source_and_expert_sha256_required")
    out = Path(args.output_dir)
    if out.exists() or out.is_symlink() or not out.parent.is_dir() or out.parent.is_symlink():
        raise ValueError("new_private_result_directory_required")
    if out.resolve() in (source, reference, source.parent, reference.parent):
        raise ValueError("results_must_be_isolated_from_source")
    if args.mode == "infer":
        if (not args.upstream_model_audited
                and not getattr(args, "operator_authorized_upstream_execution", False)):
            raise ValueError("upstream_model_requires_express_approval_or_audit")
        if not args.model_dir:
            raise ValueError("installed_trained_model_directory_required")
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
    # Explicit metric qform is a legitimate native physical grid when sform
    # is absent; never invent an affine when neither is coded in the source.
    if (ct.header.get_xyzt_units()[0] != "mm" or
            expert.header.get_xyzt_units()[0] != "mm" or
            all(int(ct.header[k]) <= 0 for k in ("sform_code", "qform_code")) or
            all(int(expert.header[k]) <= 0 for k in ("sform_code", "qform_code")) or
            not np.all(np.isfinite(ct.affine)) or
            not np.allclose(ct.affine, expert.affine, rtol=0, atol=0.05)):
        raise ValueError("original_ct_expert_native_mm_grid_mismatch")
    for volume in (ct, expert):
        if int(volume.header["qform_code"]) > 0 and not np.allclose(
                volume.get_qform(), volume.affine, rtol=0, atol=0.05):
            raise ValueError("source_sform_qform_conflict")
    if ct.header.get_data_dtype().kind not in "iuf":
        raise ValueError("unsupported_original_ct_pixel_type")
    if expert.header.get_data_dtype().kind not in "iuf":
        raise ValueError("expert_mask_must_have_integer_valued_labels")
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
        header.set_data_dtype(array.dtype)
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
        "selectedSlabExpertIsBinary": bool(np.all((raw_labels == 0) | (raw_labels == 1))),
        "voxelVolumeMl": abs(float(np.linalg.det(affine[:3, :3]))) / 1000,
    }



def classify_upstream_failure(raw: bytes, returncode: int) -> str:
    """Only bounded, typed errors from vendor logs; never patient identifiers.

    No paths, original case names, values, raw traceback or source imagery
    may enter public GitHub Actions output. Fingerprint links repeated errors.
    """
    data = raw[-32768:]
    message = data.decode("utf-8", errors="replace")
    fingerprint = hashlib.sha256(data).hexdigest()[:16]
    category = "unclassified_vendor_failure"
    detail = ""
    if found := re.search(r"No module named ['\"]([A-Za-z_][A-Za-z0-9_.]{0,78})['\"]", message):
        category = "missing_python_module"
        detail = "; module=" + found.group(1)
    elif "unrecognized arguments:" in message or "error: argument" in message:
        category = "incompatible_upstream_cli"
    elif "Weights only load failed" in message or "weights_only" in message:
        category = "upstream_pytorch_checkpoint_loader"
    elif "verified_samihs_checkpoint_was_never_loaded" in message:
        category = "official_checkpoint_not_loaded_by_vendor"
    elif "Attempting to deserialize object on a CUDA device" in message:
        category = "checkpoint_gpu_tensors_require_cpu_mapping"
    elif "Error(s) in loading state_dict" in message:
        category = "checkpoint_architecture_mismatch"
    elif ("PytorchStreamReader failed" in message or
          "failed finding central directory" in message):
        category = "unreadable_checkpoint_container"
    elif ("not compiled with CUDA" in message or "Torch not compiled with CUDA" in message
          or "CUDA is not available" in message or "Found no NVIDIA driver" in message):
        category = "upstream_requires_cuda"
    elif ("out of memory" in message.lower()
          or "cannot allocate memory" in message.lower()):
        category = "cpu_memory_exceeded"
    elif "size mismatch" in message and ("state_dict" in message or "weight" in message):
        category = "checkpoint_architecture_mismatch"
    elif "FileNotFoundError:" in message or "No such file or directory" in message:
        category = "upstream_missing_resource"
    elif "ModuleNotFoundError:" in message or "ImportError:" in message:
        category = "upstream_python_import_error"
    elif found := re.findall(r"(?m)^(RuntimeError|ValueError|TypeError|AssertionError|AttributeError|OSError|IndexError|KeyError|NotImplementedError):", message):
        category = "upstream_" + found[-1].lower()
    elif returncode < 0:
        category = "upstream_terminated_by_signal"
    return ("category=" + category + detail + "; exitCode=" + str(returncode)
            + "; diagnosticSha256Prefix=" + fingerprint)


def invoke_verified_upstream(command: list[str], model_dir: Path, timeout_seconds: int,
                            operator_authorized_legacy_pickle: bool = False):
    """Run the verified model privately; grant a SHA-scoped child token only.

    The isolated bootstrap preserves PyTorch's safe defaults for other files,
    including checkpoint loads explicitly requesting weights_only=True.
    """
    child_env = {**os.environ, "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
                 "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
    child_env.pop("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", None)
    child_env.pop("OPUS_AUTHORIZED_SAMIHS_BOOTSTRAP", None)
    if operator_authorized_legacy_pickle:
        if child_env.get("TORCH_FORCE_WEIGHTS_ONLY_LOAD", "").strip().lower() in ("1", "yes", "y", "true"):
            raise ValueError("system_forces_restricted_pytorch_checkpoint_loader")
        # Unlike TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD, this token permits only
        # the SHA-scoped loader in our isolated SAMIHS bootstrap subprocess.
        child_env["OPUS_AUTHORIZED_SAMIHS_BOOTSTRAP"] = "authorized-v1"
    with tempfile.TemporaryFile(mode="w+b") as private_log:
        result = subprocess.run(
            command, cwd=str(model_dir.resolve()), check=False,
            timeout=timeout_seconds,
            env=child_env,
            stdout=private_log, stderr=subprocess.STDOUT,
        )
        if result.returncode != 0:
            private_log.seek(0, os.SEEK_END)
            length = private_log.tell()
            private_log.seek(max(0, length - 32768))
            diagnostic = classify_upstream_failure(private_log.read(), result.returncode)
            raise RuntimeError("trained_samihs_cpu_wrapper_failed; " + diagnostic)



def summarize_stored_intensities(slab_ct, slab_expert):
    """Bounded anonymous summary of stored NIfTI values, NOT inferred HU.

    The Zenodo collection is processed/normalized, and the vendor performs
    its own per-slice percentile clipping. These values cannot reconstruct CT
    pixels; no DICOM identifiers, slice-level maps or exemplar voxels are kept.
    """
    import numpy as np

    image = np.asarray(slab_ct.dataobj)
    expert = np.asarray(slab_expert.dataobj, dtype=np.bool_)
    if image.ndim != 3 or image.shape != expert.shape or not np.all(np.isfinite(image)):
        raise ValueError("intensity_summary_requires_finite_native_source")
    p = np.percentile(image, (0.5, 50, 99.5))
    positive = image[expert]
    pp = np.percentile(positive, (0.5, 50, 99.5)) if positive.size else None
    spans = [float(np.ptp(image[:, :, k].astype(np.float64)))
             for k in range(image.shape[2])]
    return {
        "valuesAreHounsfieldUnits": False,
        "units": "native_stored_nifti_values_not_verified_HU",
        "wholeSlabPercentilesP005P50P995": [round(float(x), 5) for x in p],
        "expertPositivePercentilesP005P50P995": (
            [round(float(x), 5) for x in pp] if pp is not None else None),
        "nearConstantSourceSlices": sum(v < 1e-6 for v in spans),
        "sliceCount": len(spans),
        "vendorDocumentedPreprocessing": "slice_percentile_0.5_99.5_then_minmax",
        "vendorDocumentedOrientation": "stored_array_order_no_affine_reorientation",
        "noSourcePixelsOrIdentifiersExported": True,
    }


def read_binary_native_prediction(path: Path, original):
    """Refuse resampled, nonbinary or non-source-grid vendor output."""
    import nibabel as nib
    import numpy as np

    predicted = nib.load(str(required_file(str(path))))
    if (predicted.shape != original.shape
            or predicted.header.get_data_dtype().kind not in "iu"
            or not np.allclose(predicted.affine, original.affine, atol=0.05, rtol=0)):
        raise ValueError("trained_cpu_output_must_match_native_ct_slab")
    mask = np.asarray(predicted.dataobj)
    if not np.all((mask == 0) | (mask == 1)):
        raise ValueError("trained_cpu_output_must_be_binary")
    return mask.astype(np.bool_)


def probe_empty_mask_threshold(command: list[str], model_dir: Path, slab_ct,
                               expert, voxel_ml: float, evaluator,
                               timeout_seconds: int, authorized_pickle: bool,
                               output_path: Path):
    """Re-run authentic vendor with 0.1 threshold only after empty 0.5 mask.

    Separate research diagnostic: NOT model calibration or substituted Dice.
    Nothing about the 0.5 reference measurement or output mask is modified.
    """
    import numpy as np
    probe_path = output_path.parent / "samihs-threshold-0p1-research-only.nii.gz"
    if probe_path.exists() or probe_path.is_symlink():
        raise ValueError("threshold_probe_requires_new_isolated_output")
    probe_command = list(command)
    if probe_command.count("--output") != 1 or probe_command.count("--threshold") != 1:
        raise ValueError("unexpected_vendor_threshold_or_output_contract")
    probe_command[probe_command.index("--output") + 1] = str(probe_path)
    probe_command[probe_command.index("--threshold") + 1] = "0.1"
    started = time.monotonic()
    try:
        invoke_verified_upstream(
            probe_command, model_dir, timeout_seconds,
            operator_authorized_legacy_pickle=authorized_pickle)
        mask = read_binary_native_prediction(probe_path, slab_ct)
        metric = evaluator.segmentation_metrics(
            mask, expert, voxel_ml, slab_ct.affine)
        return {
            "status": "executed",
            "threshold": 0.1,
            "purpose": "research_diagnostic_only_not_clinical_calibration",
            "actualModelExecutionSeconds": round(time.monotonic() - started, 2),
            "maskSha256": sha256_file(probe_path),
            "predictedPositiveVoxels": int(np.count_nonzero(mask)),
            "metrics": metric,
        }
    finally:
        probe_path.unlink(missing_ok=True)


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
    # Native-value promise must survive NIfTI serialization, including slope.
    for expected, saved in ((slab_ct, ct_path), (slab_expert, expert_path)):
        loaded = nib.load(str(saved))
        if (loaded.shape != expected.shape
                or not np.allclose(loaded.affine, expected.affine, rtol=0, atol=1e-4)
                or not np.array_equal(np.asarray(loaded.dataobj),
                                      np.asarray(expected.dataobj))):
            raise ValueError("serialized_native_ct_slab_is_not_lossless")
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
        if getattr(args, "operator_authorized_upstream_execution", False):
            # The official wrapper may pass explicit weights_only=True, which
            # PyTorch's global environment override cannot change. Preserve
            # vendor source and allow legacy loading ONLY for the verified
            # SAMIHS checkpoint inside this authorized CPU process.
            bootstrap = Path(__file__).with_name("samihs-verified-cpu-bootstrap.py").resolve()
            command = [
                sys.executable, str(bootstrap), str(Path(args.model_dir).resolve()),
                args.wrapper_sha256, *command[2:],
            ]
        start_time = time.monotonic()
        try:
            invoke_verified_upstream(
                command, Path(args.model_dir), args.timeout_seconds,
                operator_authorized_legacy_pickle=bool(
                    getattr(args, "operator_authorized_upstream_execution", False)),
            )
            primary_model_seconds = round(time.monotonic() - start_time, 2)
            mask = read_binary_native_prediction(mask_path, slab_ct)
            expert_binary = np.asarray(slab_expert.dataobj, dtype=np.bool_)
            eval_path = Path(__file__).with_name("evaluate-ich-public-mask.py")
            spec = importlib.util.spec_from_file_location("ich_cpu_reference", eval_path)
            evaluator = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(evaluator)
            metrics = evaluator.segmentation_metrics(
                mask, expert_binary, coverage["voxelVolumeMl"], slab_ct.affine)
            research = {
                "sourceIntensities": summarize_stored_intensities(slab_ct, slab_expert),
                "primaryThreshold": 0.5,
                "primaryPredictedPositiveVoxels": int(np.count_nonzero(mask)),
                "lowerThresholdProbe": {
                    "status": "not_requested_or_primary_nonempty",
                    "clinicalCalibration": False,
                },
            }
            if (not np.any(mask) and getattr(args, "probe_empty_prediction", False)):
                try:
                    research["lowerThresholdProbe"] = probe_empty_mask_threshold(
                        command, Path(args.model_dir), slab_ct, expert_binary,
                        coverage["voxelVolumeMl"], evaluator, args.timeout_seconds,
                        bool(getattr(args, "operator_authorized_upstream_execution", False)),
                        mask_path)
                except Exception as error:
                    # The original reference comparison is valid even when
                    # a second diagnostic probe fails. Do not leak vendor logs.
                    research["lowerThresholdProbe"] = {
                        "status": "failed_original_primary_still_valid",
                        "failureType": type(error).__name__,
                        "clinicalCalibration": False,
                    }
            result.update({
                "status": "trained_samihs_cpu_slab_executed_and_expert_compared",
                "model": {
                    "executed": True, "device": "cpu", "batchSize": 1,
                    "checkpointSha256": SAMIHS_SHA256,
                    "wrapperSha256": args.wrapper_sha256,
                    "upstreamModelIndependentlyAudited": bool(args.upstream_model_audited),
                    "operatorAuthorizedUnverifiedCheckpoint": bool(
                        getattr(args, "operator_authorized_upstream_execution", False)),
                    "actualModelExecutionSeconds": primary_model_seconds,
                },
                "predictionMaskSha256": sha256_file(mask_path),
                "metrics": metrics,
                "researchDiagnostics": research,
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
    parser.add_argument("--probe-empty-prediction", action="store_true",
                        help="On an empty 0.5 prediction rerun the same genuine pretrained model at 0.1; keep primary results unchanged")
    parser.add_argument("--operator-authorized-upstream-execution", action="store_true",
                        help="Explicit owner authorization for pinned but unaudited upstream PyTorch code and checkpoint; not proof of independent audit")
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
        if str(error).startswith("trained_samihs_cpu_wrapper_failed; "):
            print("SAMIHS real CPU inference failed: " + str(error), file=sys.stderr)
        else:
            print("ICH bounded CPU pilot failed: " + type(error).__name__ +
                  " (private data and vendor traceback suppressed)", file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
