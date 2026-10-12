"""Pinned, offline, bounded R231 adapter. Not a pathology detector."""
import hashlib
import gc
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import socket
import struct
import sys
import time
import threading
import uuid

import numpy as np
import psutil
from resource_guard import estimate_resources
from full_ct import FULL_MAX_VOXELS, is_full_request, release_mapping, progress, write_restored_mask

MAX_VOXELS = 8_388_608
MAX_INPUT = 352 + MAX_VOXELS * 4
WEIGHTS_SHA256 = "d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f"
WEIGHTS_URL = "https://github.com/JoHof/lungmask/releases/download/v0.0/unet_r231-d5d2fc3d.pth"
VERSION = "0.2.20"


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def check_weights(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or path.stat().st_size > 150 * 1024 * 1024:
        raise ValueError("weights_unavailable")
    if digest(path) != WEIGHTS_SHA256:
        raise ValueError("weights_sha_mismatch")


def validate_request(r):
    """Only technical, allowlisted metadata; do not persist arbitrary client text."""
    keys = {"schema", "requestId", "sourceIdentitySha256", "inputSha256", "geometry",
            "modality", "frameCount", "input", "scope", "sequence", "coverage"}
    if not isinstance(r, dict) or set(r) != keys or r["schema"] not in {"opus-analysis-request/v1", "opus-analysis-request/v2"}:
        raise ValueError("invalid_request")
    identifier = uuid.UUID(r["requestId"])
    if identifier.version != 4 or str(identifier) != r["requestId"]:
        raise ValueError("invalid_request_id")
    for key in ("sourceIdentitySha256", "inputSha256"):
        if not isinstance(r[key], str) or len(r[key]) != 64 or any(c not in "0123456789abcdef" for c in r[key]):
            raise ValueError("invalid_digest")
    if r["modality"] != "CT" or r["scope"] != "selected-series-only":
        raise ValueError("unsupported_modality_or_scope")
    if r["sequence"] != "not-confirmed" or r["coverage"] != "not-confirmed":
        raise ValueError("unsupported_protocol_claim")
    if r["input"] != {"format": "NIfTI-1", "datatype": "float32",
                       "scalarValues": "cornerstone-decoded-no-additional-normalization"}:
        raise ValueError("unsupported_intensity_contract")
    g = r["geometry"]
    if not isinstance(g, dict) or set(g) != {"dimensions", "affineLps"}:
        raise ValueError("invalid_geometry")
    dims, a = g["dimensions"], g["affineLps"]
    if not isinstance(dims, list) or len(dims) != 3 or any(type(n) is not int or not 1 <= n <= 32767 for n in dims):
        raise ValueError("invalid_dimensions")
    if is_full_request(r) and (dims[0] > 512 or dims[1] > 512 or not 3 <= dims[2] <= 300):
        raise ValueError("full_stream_geometry_limit")
    if np.prod(dims, dtype=np.int64) > (FULL_MAX_VOXELS if is_full_request(r) else MAX_VOXELS) or type(r["frameCount"]) is not int or r["frameCount"] != dims[2]:
        raise ValueError("voxel_limit_or_frame_mismatch")
    if not isinstance(a, list) or len(a) != 12 or any(type(v) not in (int, float) or not np.isfinite(v) for v in a):
        raise ValueError("invalid_affine")
    matrix = np.array(a).reshape(3, 4)[:, :3]
    # R1 intentionally supports axial, axis-aligned scans only. Oblique/sheared
    # scans must not be treated as canonical numpy input by Lungmask.
    if np.max(np.abs(matrix - np.diag(np.diag(matrix)))) > 1e-5 or any(not 0.1 <= abs(v) <= 20 for v in np.diag(matrix)):
        raise ValueError("unsupported_oblique_or_nonaxial_geometry")
    return dims


def load_volume(path, r):
    dims = validate_request(r)
    path = Path(path)
    count = int(np.prod(dims))
    if path.stat().st_size != 352 + count * 4 or digest(path) != r["inputSha256"]:
        raise ValueError("input_size_or_sha_mismatch")
    with path.open("rb") as stream:
        header = stream.read(352)
    if (struct.unpack_from("<i", header)[0] != 348 or header[344:348] != b"n+1\0"
            or struct.unpack_from("<h", header, 40)[0] != 3
            or list(struct.unpack_from("<3h", header, 42)) != dims
            or struct.unpack_from("<hh", header, 70) != (16, 32)
            or struct.unpack_from("<f", header, 108)[0] != 352
            or struct.unpack_from("<ff", header, 112) != (1, 0)
            or header[123] & 7 != 2
            or struct.unpack_from("<hh", header, 252) != (0, 1)):
        raise ValueError("unsupported_nifti_header")
    actual = np.array(struct.unpack_from("<12f", header, 280)).reshape(3, 4)
    actual[:2] *= -1  # NIfTI RAS -> DICOM LPS including translation
    expected = np.array(r["geometry"]["affineLps"]).reshape(3, 4)
    # Compare physical corners, not individual coefficients alone.
    for x in (0, dims[0]-1):
        for y in (0, dims[1]-1):
            for z in (0, dims[2]-1):
                if np.linalg.norm((actual-expected) @ [x, y, z, 1]) > 0.05:
                    raise ValueError("geometry_mismatch")
    volume = np.memmap(path, dtype="<f4", mode="r", offset=352, shape=tuple(dims[::-1]))
    minimum, maximum = float("inf"), -float("inf")
    for plane in volume:
        if not np.isfinite(plane).all():
            raise ValueError("nonfinite_intensity")
        minimum, maximum = min(minimum, float(plane.min())), max(maximum, float(plane.max()))
        if is_full_request(r):
            release_mapping(volume)
    if minimum < -2048 or minimum > -700 or maximum < 0 or maximum > 65535:
        raise ValueError("unsupported_hu_range")
    return header, volume


def canonical_axes(volume, affine):
    """Lungmask numpy convention is z,y,x = inferior/superior, anterior/posterior,
    right/left. Signed axial permutations are reversible without interpolation."""
    flips = tuple(axis for axis, coefficient in [(0, affine[10]), (1, affine[5]), (2, affine[0])] if coefficient < 0)
    return np.flip(volume, flips), flips


def deny_network(*args, **kwargs):
    raise RuntimeError("inference_network_disabled")


def run(directory, weights, profile="safe"):
    started = time.perf_counter()
    directory = Path(directory)
    r = json.loads((directory / "request.json").read_text())
    validate_request(r)
    full = is_full_request(r)
    policy = estimate_resources(r["geometry"]["dimensions"], r["frameCount"], profile, full)
    if policy["estimatedModelRamBytes"] + 128 * 1024**2 > 2 * 1024**3:
        raise ValueError("model_memory_budget_exceeded")
    if profile == "safe" and hasattr(os, "nice"):
        os.nice(5)  # lower scheduling priority; never modifies the parent worker
    if profile == "safe":
        for name in ("LRU_CACHE_CAPACITY", "ONEDNN_PRIMITIVE_CACHE_CAPACITY", "DNNL_PRIMITIVE_CACHE_CAPACITY"):
            os.environ[name] = "1"  # also covers direct adapter/CLI execution
    try:
        import resource
        high_water = lambda: resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if sys.platform == "darwin" else 1024)
    except ImportError:
        high_water = lambda: 0
    try:
        process = psutil.Process()
        memory_method = "process RSS sampled every 20 ms plus getrusage high-water where available"
        rss_bytes = lambda: max(process.memory_info().rss, high_water())
    except psutil.Error:
        # Some isolated Linux runners expose a different /proc PID namespace.
        # getrusage measures this actual process without resolving a PID.
        memory_method = "getrusage process high-water RSS (PID namespace fallback)"
        rss_bytes = high_water
    sampled_peak = [rss_bytes()]
    stopped = threading.Event()
    def sample_memory():
        while not stopped.wait(0.02):
            sampled_peak[0] = max(sampled_peak[0], rss_bytes())
            if sampled_peak[0] > policy["maxRssBytes"]:
                os._exit(75)  # child-side guard also covers PID namespace isolation
    threading.Thread(target=sample_memory, daemon=True).start()
    check_weights(weights)
    if importlib.metadata.version("lungmask") != VERSION:
        raise ValueError("unsupported_lungmask_version")
    header, volume = load_volume(directory / "input.nii", r)
    # Defence against accidental upstream downloads. Not an OS network sandbox;
    # this trusted pinned adapter also has no outbound paths or provider clients.
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.socket.sendto = deny_network
    socket.create_connection = deny_network
    socket.getaddrinfo = deny_network
    socket.gethostbyname = deny_network
    socket.gethostbyname_ex = deny_network
    import torch
    import r231_lungmask_utils as utils
    from r231_inference import load_model, predict_slice, predict_slices, restore_slices
    torch.set_num_threads(policy["threads"])
    torch.set_num_interop_threads(policy["interOpThreads"])
    # Force safe state-dict loading even if upstream omits weights_only.
    os.environ["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"
    canonical, flips = canonical_axes(volume, r["geometry"]["affineLps"])
    model = load_model(weights)
    infer_started = time.perf_counter()
    compact_labels, boxes = predict_slices(canonical, lambda plane: predict_slice(model, plane), utils,
        (lambda: release_mapping(volume)) if full else (lambda: None),
        (lambda n: progress(directory, "inference", n, r["frameCount"])) if full else (lambda n: None))
    # No further neural inference is needed. Release weights before connected
    # components allocate their volume workspaces; the process exits per job.
    del model
    gc.collect()
    if full:
        progress(directory, "postprocessing", 0, r["frameCount"])
    compact_labels = utils.postprocessing(compact_labels, disable_tqdm=True)
    if full:
        counts = write_restored_mask(directory / "mask.nii", header, compact_labels, boxes, canonical.shape, utils, flips,
            lambda n: progress(directory, "restoration", n, r["frameCount"]))
    else:
        output = np.flip(restore_slices(compact_labels, boxes, canonical.shape, utils), flips)
    del compact_labels, boxes
    inference_seconds = time.perf_counter() - infer_started
    # Range check avoids np.unique's additional full mask copy/sort.
    if not full and (output.shape != volume.shape or output.min() < 0 or output.max() > 2):
        raise ValueError("invalid_model_output")
    if not full and not np.any(output):
        raise ValueError("empty_mask_needs_review")
    mask_header = bytearray(header)
    struct.pack_into("<hh", mask_header, 70, 2, 8)
    if not full:
        with (directory / "mask.nii").open("xb") as stream:
            stream.write(mask_header)
            for plane in output:
                stream.write(plane.tobytes())
    result = {"schema": "opus-segmentation-result/v1",
              **{k: r[k] for k in ("requestId", "sourceIdentitySha256", "inputSha256")},
              "maskSha256": digest(directory / "mask.nii"),
              "model": {"id": "lungmask-R231", "version": VERSION,
                        "weightsSha256": WEIGHTS_SHA256, "modality": "CT", "task": "lung-segmentation"},
              "labels": [{"id": 1, "name": "Right lung"}, {"id": 2, "name": "Left lung"}],
              "limitations": ["Experimental; clinician review required. Not a pathology detector.",
                              "Axial CT in HU only; anatomy and full coverage are not automatically verified.",
                              "Whole supplied series processed; anatomy/full acquisition coverage unconfirmed. Native mask streamed to disk." if full else
                              "Bounded to 8,388,608 voxels; no hidden downsampling or cropped-volume substitution."]}
    if full:
        result["fullVolume"] = {"dimensions": r["geometry"]["dimensions"], "labelVoxels": counts[1:],
                                "coverage": "all-supplied-frames", "clinicalStatus": "unverified_research_draft"}
    (directory / "result.json").write_text(json.dumps(result))
    sampled_peak[0] = max(sampled_peak[0], rss_bytes())
    stopped.set()
    metrics = {"schema": "opus-worker-metrics/v1", "device": "cpu", "batchSize": 1,
               "inferenceSeconds": round(inference_seconds, 3),
               "totalSeconds": round(time.perf_counter()-started, 3),
               "peakRssMiB": round(sampled_peak[0] / 1024**2, 2),
               "memoryMeasurement": memory_method,
               "platform": platform.system(), "machine": platform.machine(),
               "torchVersion": torch.__version__, "dimensions": r["geometry"]["dimensions"],
               "resourceProfile": profile, "threads": policy["threads"], "interOpThreads": policy["interOpThreads"],
               "inferenceImplementation": "full-ct-streamed-r231/v2" if full else "slice-streamed-r231/v1", "weightsLoading": "meta-assign-cpu-float32",
               "simpleItkImported": "SimpleITK" in sys.modules,
               "clinicalStatus": "unverified_research_draft"}
    (directory / "metrics.json").write_text(json.dumps(metrics))


if __name__ == "__main__":
    try:
        run(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3] if len(sys.argv) > 3 else "safe")
    except Exception:
        # No client metadata, filesystem paths, raw library errors or PHI in logs.
        sys.exit(1)
