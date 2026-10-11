#!/usr/bin/env python3
"""Offline 2D ONNX segmentation of an Opus MPR-exported NIfTI series.

Requires separately installed numpy and onnxruntime, and model weights with a
matching, user-reviewed model card. No downloads, HTTP calls, DICOM metadata
uploads, OpenRouter or shell execution. Actual inference or explicit failure:
never create a synthetic mask pretending to be medical AI.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import sys
import uuid

MAX_INPUT = 352 + 4 * 8_388_608
MAX_MASK = 32 * 1024 * 1024
SHA = re.compile(r"^[a-f0-9]{64}$")
TEXT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/+-]{0,99}$")


class InferenceError(Exception):
    pass


def digest(path: Path, size_limit: int | None = None) -> str:
    if not path.is_file() or path.is_symlink():
        raise InferenceError("Regular, non-symlink input required")
    if size_limit is not None and path.stat().st_size > size_limit:
        raise InferenceError("Input file exceeds memory guard")
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def small_json(path: Path, maximum: int = 65536):
    if not path.is_file() or path.is_symlink() or path.stat().st_size > maximum:
        raise InferenceError("Invalid or oversized JSON")
    return json.loads(path.read_text(encoding="utf-8"))


def request_contract(data):
    if not isinstance(data, dict) or data.get("schema") != "opus-analysis-request/v1":
        raise InferenceError("Unsupported Opus analysis request")
    try:
        reqid = str(uuid.UUID(data["requestId"]))
        if uuid.UUID(reqid).version != 4 or reqid != data["requestId"]:
            raise ValueError()
        if any(not isinstance(data.get(k), str) or not SHA.fullmatch(data[k])
               for k in ("sourceIdentitySha256", "inputSha256")):
            raise ValueError()
        grid = data["geometry"]
        dims, affine = grid["dimensions"], grid["affineLps"]
        if (len(dims) != 3 or any(type(v) is not int or v < 1 for v in dims) or
                len(affine) != 12 or any(not isinstance(v, (int, float)) for v in affine)):
            raise ValueError()
        if dims[0] * dims[1] * dims[2] > 8_388_608:
            raise ValueError()
        if data.get("frameCount") != dims[2]:
            raise ValueError()
        if data.get("scope") != "selected-series-only":
            raise ValueError()
        if data.get("input") != {"format": "NIfTI-1", "datatype": "float32",
                                  "scalarValues": "cornerstone-decoded-no-additional-normalization"}:
            raise ValueError()
    except (KeyError, ValueError, TypeError, AttributeError):
        raise InferenceError("Invalid Opus request identity, geometry or scope") from None
    return dims, affine


def profile_contract(data):
    if not isinstance(data, dict) or data.get("schema") != "opus-local-onnx-profile/v1":
        raise InferenceError("Unsupported model profile")
    if set(data.keys()) != {"schema", "model", "preprocessing", "output", "limitations"}:
        raise InferenceError("Unknown or missing model profile fields")
    model = data["model"]
    if not isinstance(model, dict) or set(model) != {
            "id", "version", "modality", "task", "sha256", "label"}:
        raise InferenceError("Invalid model provenance")
    if any(not isinstance(model.get(k), str) or not TEXT.fullmatch(model[k])
           for k in ("id", "version", "modality", "task")):
        raise InferenceError("Invalid model identifiers")
    if model["modality"] not in ("CT", "MR") or not SHA.fullmatch(model["sha256"]):
        raise InferenceError("Invalid modality or unpinned ONNX checkpoint")
    label = model["label"]
    if (not isinstance(label, str) or not 1 <= len(label) <= 120 or
            any(ord(c) < 32 for c in label)):
        raise InferenceError("Invalid model output label")
    prep = data["preprocessing"]
    if not isinstance(prep, dict) or set(prep) != {"method", "clipMin", "clipMax"}:
        raise InferenceError("Preprocessing contract must declare exact fixed clipping")
    if prep["method"] != "fixed-clip-zero-one":
        raise InferenceError("Unsupported preprocessing normalization")
    low, high = prep["clipMin"], prep["clipMax"]
    if (type(low) not in (int, float) or type(high) not in (int, float) or
            not (-100000 <= low < high <= 100000)):
        raise InferenceError("Invalid model input intensity range")
    output = data["output"]
    if (not isinstance(output, dict) or set(output) != {"format", "threshold", "activation"} or
            output["format"] != "NCHW-single-channel-binary" or
            output["activation"] not in ("identity", "sigmoid") or
            type(output["threshold"]) not in (int, float) or
            not 0 < output["threshold"] < 1):
        raise InferenceError("Unsupported binary output contract")
    limits = data["limitations"]
    if (not isinstance(limits, list) or len(limits) > 12 or
            any(not isinstance(x, str) or not 1 <= len(x) <= 400 or
                any(ord(c) < 32 for c in x) for x in limits)):
        raise InferenceError("Invalid model limitations")
    return data


def load_opus_volume(path: Path, expected_dims, expected_affine):
    """Read only the exact NIfTI-1 float32 layout emitted by Opus in LPS mm."""
    import numpy as np

    data = path.read_bytes()
    if len(data) > MAX_INPUT or len(data) < 352:
        raise InferenceError("Invalid Opus NIfTI size")
    if struct.unpack_from("<i", data)[0] != 348 or data[344:348] != b"n+1\x00":
        raise InferenceError("Expected little-endian single-file NIfTI-1")
    if struct.unpack_from("<h", data, 40)[0] != 3:
        raise InferenceError("Expected 3D scalar NIfTI")
    dimensions = struct.unpack_from("<3h", data, 42)
    if list(dimensions) != expected_dims:
        raise InferenceError("Actual dimensions do not match Opus manifest")
    if struct.unpack_from("<hh", data, 70) != (16, 32):
        raise InferenceError("Expected float32 NIfTI intensities")
    if struct.unpack_from("<f", data, 108)[0] != 352:
        raise InferenceError("Expected exactly 352-byte NIfTI offset")
    if data[123] & 7 != 2 or struct.unpack_from("<h", data, 254)[0] != 1:
        raise InferenceError("Expected sform in millimetres")
    if struct.unpack_from("<h", data, 252)[0] != 0:
        raise InferenceError("Unexpected additional qform")
    encoded = list(struct.unpack_from("<12f", data, 280))
    affine_lps = [v * (-1 if i < 8 else 1) for i, v in enumerate(encoded)]
    if any(not abs(v - float(e)) <= 0.05 for v, e in zip(affine_lps, expected_affine)):
        raise InferenceError("NIfTI physical geometry differs from request")
    nx, ny, nz = expected_dims
    count = nx * ny * nz
    if len(data) != 352 + count * 4:
        raise InferenceError("NIfTI includes missing or unexpected extra voxels")
    volume = np.frombuffer(data, dtype="<f4", offset=352).reshape((nz, ny, nx))
    if not np.isfinite(volume).all():
        raise InferenceError("NIfTI contains nonfinite intensities")
    return data[:352], volume


def write_nifti_mask(original_header: bytes, mask, path: Path):
    """Exact voxel grid and original sform; labels are uint8 0 or 1 only."""
    header = bytearray(original_header)
    struct.pack_into("<h", header, 70, 2)
    struct.pack_into("<h", header, 72, 8)
    struct.pack_into("<f", header, 112, 1.0)
    struct.pack_into("<f", header, 116, 0.0)
    contents = bytes(header) + mask.tobytes(order="C")
    if len(contents) > MAX_MASK:
        raise InferenceError("Result mask exceeds browser import limit")
    exclusive_write(path, contents)
    return hashlib.sha256(contents).hexdigest()


def exclusive_write(path: Path, payload: bytes):
    if path.is_symlink():
        raise InferenceError("Refusing symlink output")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def infer_volume(volume, weights: Path, model_card):
    """Actual ONNX Runtime inference; never substitute mock output."""
    import numpy as np
    try:
        import onnxruntime as ort
    except ImportError:
        raise InferenceError("onnxruntime missing; install numpy and onnxruntime") from None

    # Two CPU threads bound the burden on an 8 GB Apple M1 laptop.
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    session = ort.InferenceSession(str(weights), sess_options=options,
                                   providers=["CPUExecutionProvider"])
    inputs, outputs = session.get_inputs(), session.get_outputs()
    if len(inputs) != 1 or len(outputs) != 1:
        raise InferenceError("Model must have exactly one input and one output")
    inp, out = inputs[0], outputs[0]
    if inp.type != "tensor(float)" or len(inp.shape) != 4 or len(out.shape) != 4:
        raise InferenceError("ONNX model must use float32 NCHW tensors")
    nz, ny, nx = volume.shape
    for shape in (inp.shape, out.shape):
        for expected, actual in zip(shape, (1, 1, ny, nx)):
            if isinstance(expected, int) and expected != actual:
                raise InferenceError("ONNX tensor shape not compatible with source slices")
    low, high = model_card["preprocessing"]["clipMin"], model_card["preprocessing"]["clipMax"]
    threshold = model_card["output"]["threshold"]
    labels = np.zeros((nz, ny, nx), dtype=np.uint8)
    for z in range(nz):
        array = np.clip(volume[z], low, high)
        array = ((array - low) / (high - low)).astype("float32", copy=False)
        input_tensor = np.ascontiguousarray(array[None, None, :, :])
        output = session.run([out.name], {inp.name: input_tensor})[0]
        if not isinstance(output, np.ndarray) or output.shape != (1, 1, ny, nx):
            raise InferenceError("ONNX output dimensions do not match image")
        if not np.isfinite(output).all():
            raise InferenceError("ONNX output contains nonfinite logits/probabilities")
        if model_card["output"]["activation"] == "sigmoid":
            output = 1.0 / (1.0 + np.exp(-np.clip(output, -80, 80)))
        elif np.any(output < 0) or np.any(output > 1):
            raise InferenceError("Model output is not a probability [0,1]")
        labels[z] = (output[0, 0] >= threshold).astype(np.uint8)
    return labels


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input", type=Path, required=True, help="Exported Opus .nii")
    p.add_argument("--request", type=Path, required=True, help="Paired Opus .request.json")
    p.add_argument("--model", type=Path, required=True, help="Actual local .onnx weights")
    p.add_argument("--profile", type=Path, required=True, help="Reviewed ONNX model profile JSON")
    p.add_argument("--mask", type=Path, required=True, help="New output segmentation .nii")
    p.add_argument("--result", type=Path, required=True, help="New output passport JSON")
    a = p.parse_args()
    if a.mask.resolve() == a.result.resolve():
        raise InferenceError("Mask and result output paths must differ")
    if a.mask.exists() or a.mask.is_symlink() or a.result.exists() or a.result.is_symlink():
        raise InferenceError("Refusing to overwrite any output")
    request = small_json(a.request)
    dims, affine = request_contract(request)
    profile = profile_contract(small_json(a.profile))
    card = profile["model"]
    if request.get("modality") != card["modality"]:
        raise InferenceError("Checkpoint modality does not match actual DICOM series")
    if digest(a.input, MAX_INPUT) != request["inputSha256"]:
        raise InferenceError("Original volume SHA-256 mismatch; aborting before inference")
    actual_weights_hash = digest(a.model, 600 * 1024 * 1024)
    if a.model.suffix.lower() != ".onnx" or actual_weights_hash != card["sha256"]:
        raise InferenceError("Checkpoint hash mismatch; refuses unpinned/unrecognised weights")
    header, volume = load_opus_volume(a.input, dims, affine)
    mask = infer_volume(volume, a.model, profile)
    if mask.shape != volume.shape:
        raise InferenceError("Model result changed the physical grid")
    if not mask.any():
        raise InferenceError("No positive voxels; empty result is not automatically an absence of pathology")
    if not profile["limitations"]:
        raise InferenceError("Model profile must document limitations")
    result = {
        "schema": "opus-segmentation-result/v1",
        "requestId": request["requestId"],
        "sourceIdentitySha256": request["sourceIdentitySha256"],
        "inputSha256": request["inputSha256"],
        "maskSha256": None,
        "model": {
            "id": card["id"], "version": card["version"],
            "weightsSha256": actual_weights_hash,
            "modality": card["modality"], "task": card["task"],
        },
        "labels": [{"id": 1, "name": card["label"]}],
        "limitations": profile["limitations"] + [
            "Offline 2D per-slice segmentation only; not validated as a disease detector.",
            "No whole-study diagnostic coverage. Mandatory physician review.",
        ],
    }
    mask_created = False
    try:
        result["maskSha256"] = write_nifti_mask(header, mask, a.mask)
        mask_created = True
        payload = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        if len(payload) > 65536:
            raise InferenceError("Result passport exceeds 64 KiB")
        exclusive_write(a.result, payload)
    except BaseException:
        if mask_created:
            a.mask.unlink(missing_ok=True)
        raise
    print("REAL OFFLINE ONNX INFERENCE COMPLETED")
    print("Backend: CPUExecutionProvider; transferred to cloud: 0 bytes")
    print(f"Mask voxels: {int(mask.sum())}; slices: {mask.shape[0]}")
    print("Next: import both .nii + .json in Opus MPR; review mask clinically.")


if __name__ == "__main__":
    try:
        main()
    except (InferenceError, OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        print(f"LOCAL INFERENCE REFUSED: {exc}", file=sys.stderr)
        sys.exit(1)
