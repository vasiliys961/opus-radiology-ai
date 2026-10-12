"""NIfTI sform codes 1 (scanner) and 2 (aligned) are both legitimate."""
import struct
import pytest
from totalsegmentator_result import validate_native_mask

DIMS=(4,3,3)
AFF=[1.,0.,0.,7.,0.,1.,0.,8.,0.,0.,2.,9.]
SHA="a"*64

def write_mask(tmp_path,sform):
    h=bytearray(352)
    struct.pack_into("<i",h,0,348)
    struct.pack_into("<4h",h,40,3,*DIMS)
    struct.pack_into("<hh",h,70,2,8)
    struct.pack_into("<f",h,108,352.)
    struct.pack_into("<ff",h,112,1.,0.)
    struct.pack_into("<hh",h,252,0,sform)
    ras=AFF.copy()
    ras[:8]=[-n for n in ras[:8]]
    struct.pack_into("<12f",h,280,*ras)
    h[344:348]=b"n+1\x00"
    p=tmp_path/"mask.nii"
    p.write_bytes(h+bytes([10]*36))
    return p

@pytest.mark.parametrize("sform",[1,2,3,4])
def test_nifti_sform_codes_supported(tmp_path,sform):
    p=write_mask(tmp_path,sform)
    assert validate_native_mask(p,DIMS,AFF,SHA,allowed_labels=[10])["labelVoxels"][0]["voxels"]==36

@pytest.mark.parametrize("sform",[0,5,-1])
def test_absent_or_unknown_sform_refused(tmp_path,sform):
    with pytest.raises(ValueError,match="header"):
        validate_native_mask(write_mask(tmp_path,sform),DIMS,AFF,SHA,allowed_labels=[10])
