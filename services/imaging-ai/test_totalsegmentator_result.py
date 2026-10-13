import struct
import pytest
from totalsegmentator_result import validate_native_mask
DIMS=[4,3,3]
AFFINE=[1.,0.,0.,7.,0.,1.,0.,8.,0.,0.,2.,9.]
SOURCE="a"*64

def mask(tmp_path,values=None):
    header=bytearray(352)
    struct.pack_into("<i",header,0,348)
    struct.pack_into("<4h",header,40,3,*DIMS)
    struct.pack_into("<hh",header,70,2,8)
    struct.pack_into("<f",header,108,352.)
    struct.pack_into("<ff",header,112,1.,0.)
    struct.pack_into("<hh",header,252,0,1)
    ras=AFFINE.copy()
    ras[:8]=[-x for x in ras[:8]]
    struct.pack_into("<12f",header,280,*ras)
    header[344:348]=b"n+1\x00"
    path=tmp_path/"mask.nii"
    path.write_bytes(header+(values if values is not None else bytes([10,11,12,13,14,0]*6)))
    return path

def test_five_native_lobes(tmp_path):
    result=validate_native_mask(mask(tmp_path),DIMS,AFFINE,SOURCE)
    assert [x["voxels"] for x in result["labelVoxels"]]==[6]*5

def test_grid_mismatch(tmp_path):
    a=AFFINE.copy();a[3]+=1
    with pytest.raises(ValueError,match="geometry"):
        validate_native_mask(mask(tmp_path),DIMS,a,SOURCE)

def test_unknown_label(tmp_path):
    with pytest.raises(ValueError,match="label"):
        validate_native_mask(mask(tmp_path,bytes([15]+[10]*35)),DIMS,AFFINE,SOURCE)

def test_empty_and_truncated(tmp_path):
    path=mask(tmp_path,bytes(36))
    with pytest.raises(ValueError,match="empty"):
        validate_native_mask(path,DIMS,AFFINE,SOURCE)
    path.write_bytes(path.read_bytes()[:-1])
    with pytest.raises(ValueError,match="file"):
        validate_native_mask(path,DIMS,AFFINE,SOURCE)

def test_reject_wrong_source_and_subset(tmp_path):
    path=mask(tmp_path)
    with pytest.raises(ValueError,match="source_identity"):
        validate_native_mask(path,DIMS,AFFINE,"invalid")
    with pytest.raises(ValueError,match="label"):
        validate_native_mask(path,DIMS,AFFINE,SOURCE,[10])

def test_symlink(tmp_path):
    path=mask(tmp_path); link=tmp_path/"link.nii";link.symlink_to(path)
    with pytest.raises(ValueError,match="file"):
        validate_native_mask(link,DIMS,AFFINE,SOURCE)


def test_native_mm_units_produce_calibrated_partial_mask_volumes(tmp_path):
    path=mask(tmp_path)
    data=bytearray(path.read_bytes())
    data[123]=2 # xyzt_units: mm
    path.write_bytes(data)
    result=validate_native_mask(path,DIMS,AFFINE,SOURCE)
    assert result["nativeSpatialUnitsVerified"] is True
    assert result["voxelVolumeMm3"]==2.0
    assert all(row["labelMaskVolumeMl"]==0.012 for row in result["labelVoxels"])
    assert result["maskVolumeSemantics"]=="native_grid_label_volume_only_not_full_organ_volume"
    assert result["qualityReview"]["fullAnatomicCoverageVerified"] is False

def test_unspecified_spatial_units_do_not_manufacture_ml(tmp_path):
    result=validate_native_mask(mask(tmp_path),DIMS,AFFINE,SOURCE)
    assert result["nativeSpatialUnitsVerified"] is False
    assert result["voxelVolumeMm3"] is None
    assert all(row["labelMaskVolumeMl"] is None for row in result["labelVoxels"])

def test_sheared_native_mm_affine_uses_true_determinant(tmp_path):
    path=mask(tmp_path)
    data=bytearray(path.read_bytes())
    data[123]=2
    # preserve mask world geometry by supplying the same sheared affine LPS
    skew=AFFINE.copy()
    skew[1]=0.25 # linear LPS x-row y-column
    ras=skew.copy()
    ras[:8]=[-x for x in ras[:8]]
    struct.pack_into("<12f",data,280,*ras)
    path.write_bytes(data)
    result=validate_native_mask(path,DIMS,skew,SOURCE)
    assert result["nativeSpatialUnitsVerified"] is True
    assert result["voxelVolumeMm3"]==2.0
