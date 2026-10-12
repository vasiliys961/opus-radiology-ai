import numpy as np
import nibabel as nib
import pytest
from totalsegmentator_offline_exec import normalize_model_mask
from totalsegmentator_result import validate_native_mask

AFFINE_LPS=[1.,0.,0.,7.,0.,1.,0.,8.,0.,0.,2.,9.]
def sample(tmp_path,label=10):
    arr=np.zeros((4,3,3),dtype=np.uint16)
    arr[1,1,1]=label
    ras=np.asarray(AFFINE_LPS).reshape((3,4)).copy()
    ras[:2,:]*=-1
    affine=np.eye(4);affine[:3,:]=ras
    p=tmp_path/"mask.nii"
    nib.save(nib.Nifti1Image(arr,affine),str(p))
    return p

def test_canonicalize_uint16_real_nifti(tmp_path):
    p=sample(tmp_path)
    normalize_model_mask(p,(4,3,3),AFFINE_LPS,{10,11,12,13,14})
    assert validate_native_mask(p,(4,3,3),AFFINE_LPS,"a"*64,[10])["labelVoxels"][0]["voxels"]==1

def test_reject_wrong_label_before_conversion(tmp_path):
    p=sample(tmp_path,99)
    with pytest.raises(ValueError,match="unexpected_mask_label"):
        normalize_model_mask(p,(4,3,3),AFFINE_LPS,{10,11,12,13,14})

def test_reject_geometry_change(tmp_path):
    p=sample(tmp_path)
    changed=AFFINE_LPS.copy();changed[3]+=1
    with pytest.raises(ValueError,match="mask_geometry_mismatch"):
        normalize_model_mask(p,(4,3,3),changed,{10})
