import struct
import pytest
from totalsegmentator_input import inspect_input

def create(tmp_path, dims=(4,3,3), datatype=16, bitpix=32):
    header = bytearray(352)
    struct.pack_into("<i", header, 0, 348)
    struct.pack_into("<4h", header, 40, 3, *dims)
    struct.pack_into("<hh", header, 70, datatype, bitpix)
    struct.pack_into("<f", header, 108, 352.)
    header[344:348] = b"n+1\\x00"
    path=tmp_path/"ct.nii"
    path.write_bytes(header+bytes(dims[0]*dims[1]*dims[2]*(bitpix//8)))
    return path

def test_valid_canonical_nifti(tmp_path):
    assert inspect_input(create(tmp_path))["dimensions"] == (4,3,3)

def test_reject_truncation(tmp_path):
    p=create(tmp_path)
    p.write_bytes(p.read_bytes()[:-1])
    with pytest.raises(ValueError,match="size"):
        inspect_input(p)

def test_reject_unsupported_type(tmp_path):
    with pytest.raises(ValueError,match="datatype"):
        inspect_input(create(tmp_path,datatype=32,bitpix=64))

def test_reject_oversized_shape(tmp_path):
    with pytest.raises(ValueError,match="shape"):
        inspect_input(create(tmp_path,dims=(513,1,1)))

def test_reject_symlink(tmp_path):
    p=create(tmp_path)
    link=tmp_path/"link.nii"
    link.symlink_to(p)
    with pytest.raises(ValueError,match="unsafe"):
        inspect_input(link)
