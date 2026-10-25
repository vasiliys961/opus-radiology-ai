"""Synthetic contract for lesion-level metrics; NOT trained-model validation."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
import nibabel as nib

spec = importlib.util.spec_from_file_location("compai_lesion", Path(__file__).with_name("score-compai-model7-lesions.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with TemporaryDirectory() as td:
    root=Path(td)
    ct=np.zeros((10, 10, 10),dtype=np.uint8)
    pred=ct.copy()
    ref=ct.copy()
    ref[1:3, 1:3, 1:3]=1
    ref[6:8, 6:8, 6:8]=1
    pred[1:3, 1:3, 1:3]=1
    pred[4, 4, 4]=1
    for name, arr in [("ct",ct),("prediction",pred),("expert",ref)]:
        nib.save(nib.Nifti1Image(arr,np.eye(4)),root/(name+".nii.gz"))
    x=m.score(root/"prediction.nii.gz",root/"expert.nii.gz",root/"ct.nii.gz")
    assert x["expertNodeComponents"]==2, x
    assert x["detectedExpertNodeComponents"]==1, x
    assert x["missedExpertNodeComponents"]==1, x
    assert x["unmatchedPredictionComponents"]==1, x
    assert x["expertComponentRecall"]==0.5, x
    assert x["clinicalValidation"] is False
    try:
        m.score(root/"prediction.nii.gz",root/"expert.nii.gz",root/"ct.nii.gz",max_voxels=9)
        raise AssertionError("Expected RAM bound")
    except ValueError:
        pass
print("PASS synthetic lesion-level geometry/recall contract")
