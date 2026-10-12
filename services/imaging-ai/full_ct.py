"""Separate bounded full-CT contract; existing v1 voxel admission stays unchanged."""
import json
import mmap
from pathlib import Path
import struct

import numpy as np

FULL_MAX_FRAMES = 300
FULL_MAX_PLANE = 512 * 512
FULL_MAX_VOXELS = FULL_MAX_FRAMES * FULL_MAX_PLANE
FULL_MAX_INPUT = 352 + FULL_MAX_VOXELS * 4


def is_full_request(request):
    return request.get("schema") == "opus-analysis-request/v2"


def release_mapping(volume):
    mapping = getattr(volume, "_mmap", None)
    advice = getattr(mmap, "MADV_DONTNEED", None)
    if mapping is not None and advice is not None:
        try:
            mapping.madvise(advice)
        except (OSError, ValueError):
            pass  # RSS/system-pressure guards remain mandatory on every platform.


def progress(directory, stage, completed, frames):
    path = Path(directory) / "progress.tmp"
    path.write_text(json.dumps({"stage": stage, "completedFrames": completed, "totalFrames": frames}))
    path.replace(Path(directory) / "progress.json")


def write_restored_mask(path, header, labels, boxes, shape, utils, flips, on_progress=lambda n: None):
    """Write one restored plane at its exact native offset, never a full native mask."""
    header = bytearray(header)
    struct.pack_into("<hh", header, 70, 2, 8)
    plane_size = shape[1] * shape[2]
    counts = [0, 0, 0]
    with Path(path).open("xb") as output:
        output.write(header)
        output.truncate(352 + shape[0] * plane_size)
        for z, label in enumerate(labels):
            plane = np.asarray(utils.reshape_mask(label, boxes[z], shape[1:]), dtype=np.uint8)
            if plane.shape != tuple(shape[1:]) or np.any(plane > 2):
                raise ValueError("invalid_model_output")
            plane = np.flip(plane, tuple(a - 1 for a in flips if a != 0))
            native_z = shape[0] - 1 - z if 0 in flips else z
            output.seek(352 + native_z * plane_size)
            output.write(plane.tobytes())
            for value in (1, 2):
                counts[value] += int(np.count_nonzero(plane == value))
            on_progress(z + 1)
    if not sum(counts):
        raise ValueError("empty_mask_needs_review")
    return counts


def crop_mask(directory, request, start, count):
    """Bounded native mask derivative, retaining whole-job identity in its proof."""
    dims = request["geometry"]["dimensions"]
    if (type(start) is not int or type(count) is not int or start < 0 or count < 3
            or start + count > dims[2] or dims[0] * dims[1] * count > 8_388_608 or count > 32):
        raise ValueError("invalid_mask_range")
    directory = Path(directory)
    full = directory / "mask.nii"
    if full.stat().st_size != 352 + int(np.prod(dims)):
        raise ValueError("invalid_full_mask_size")
    with full.open("rb") as source:
        header = bytearray(source.read(352))
        struct.pack_into("<h", header, 46, count)
        affine = list(request["geometry"]["affineLps"])
        for row in range(3):
            affine[row * 4 + 3] += affine[row * 4 + 2] * start
        ras = [(-v if i < 8 else v) for i, v in enumerate(affine)]
        struct.pack_into("<12f", header, 280, *ras)
        output_path = directory / f"slab-{start}-{count}.nii"
        # At most one cached derivative. Callers serialize extraction with uploadLock.
        for previous in directory.glob("slab-*.nii"):
            previous.unlink()
        with output_path.open("xb") as output:
            output.write(header)
            source.seek(352 + start * dims[0] * dims[1])
            remaining = count * dims[0] * dims[1]
            while remaining:
                data = source.read(min(128 * 1024, remaining))
                if not data:
                    raise ValueError("truncated_full_mask")
                output.write(data)
                remaining -= len(data)
    return output_path, {"dimensions": [dims[0], dims[1], count], "affineLps": affine}
