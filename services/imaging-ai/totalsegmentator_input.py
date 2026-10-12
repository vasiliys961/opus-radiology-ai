"""Strict, bounded, uncompressed NIfTI input preflight, before model import."""
import math
import os
import stat
import struct
from pathlib import Path

LIMITS = (512, 512, 300)
SUPPORTED = {2: 8, 4: 16, 8: 32, 16: 32, 64: 64, 512: 16}

def inspect_input(path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("unsafe_nifti_path")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size < 353:
            raise ValueError("invalid_nifti_file")
        header = os.read(fd, 352)
        if (len(header) != 352 or struct.unpack_from("<i", header)[0] != 348
                or header[344:348] != b"n+1\x00"
                or struct.unpack_from("<h", header, 40)[0] != 3):
            raise ValueError("invalid_nifti_header")
        dimensions = tuple(struct.unpack_from("<3h", header, 42))
        if any(not 1 <= x <= limit for x, limit in zip(dimensions, LIMITS)):
            raise ValueError("unsupported_input_shape")
        datatype, bitpix = struct.unpack_from("<hh", header, 70)
        if SUPPORTED.get(datatype) != bitpix:
            raise ValueError("invalid_input_datatype")
        offset = struct.unpack_from("<f", header, 108)[0]
        if offset != 352.0:
            raise ValueError("unsupported_input_offset")
        expected = 352 + math.prod(dimensions) * (bitpix // 8)
        if info.st_size != expected:
            raise ValueError("invalid_input_size")
        return {"dimensions": dimensions, "bytes": expected, "datatype": datatype}
    finally:
        os.close(fd)
