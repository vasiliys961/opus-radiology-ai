#!/usr/bin/env python3
"""Bounded deterministic contract test (not trained-model evidence)."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import numpy as np
import nibabel as nib

source = Path(__file__).with_name("score-compai-model7-expert.py")
spec = importlib.util.spec_from_file_location("compai_expert_score", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with TemporaryDirectory() as d:
    root = Path(d)
    img = np.zeros((5, 6, 4), dtype=np.uint8)
    pred = img.copy()
    expert = img.copy()
    pred[1, 1, 1] = 1
    pred[2, 2, 1] = 1
    expert[1, 1, 1] = 1
    expert[3, 3, 1] = 1
    affine = np.diag([1., 2., 3., 1.])
    for name, data in [("ct", img), ("pred", pred), ("expert", expert)]:
        nib.save(nib.Nifti1Image(data, affine), root / (name + ".nii.gz"))
    report = module.score(root / "pred.nii.gz", root / "expert.nii.gz", root / "ct.nii.gz")
    assert (report["TP"], report["FP"], report["FN"], report["TN"]) == (1, 1, 1, 117)
    assert report["dice"] == 0.5
    assert report["clinicalValidation"] is False
    nib.save(nib.Nifti1Image(expert, np.diag([1., 2., 4., 1.])), root / "wrong.nii.gz")
    try:
        module.score(root / "pred.nii.gz", root / "wrong.nii.gz", root / "ct.nii.gz")
        raise AssertionError("Expected geometry rejection")
    except ValueError:
        pass
print("CompAI native-mask scoring contract PASS (synthetic test only)")
