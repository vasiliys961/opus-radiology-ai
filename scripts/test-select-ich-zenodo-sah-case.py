#!/usr/bin/env python3
"""Tests of actual original NIfTI matching; all generated data are synthetic."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

p=Path(__file__).with_name("select-ich-zenodo-sah-case.py")
spec=importlib.util.spec_from_file_location("source_pair",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def save(path, values, affine=None):
    if affine is None:
        affine=np.diag([.8,.8,2.,1.])
    path.parent.mkdir(parents=True,exist_ok=True)
    nii=nib.Nifti1Image(values,affine)
    nii.header.set_xyzt_units(xyz="mm")
    nii.set_sform(affine,code=1)
    nii.set_qform(affine,code=1)
    nib.save(nii,str(path))
    return path


class Pairing(unittest.TestCase):
    def test_positive_mask_must_match_subject_and_geometry(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            a=np.zeros((32,32,40),dtype=np.float32)
            a[4,5,20]=93.0
            b=np.zeros(a.shape,dtype=np.uint8)
            b[4,5,20]=1
            save(root/"ct"/"case013_ct.nii.gz",a)
            expert=save(root/"gt"/"case013_mask.nii.gz",b)
            _,chosen,start=mod.select_public_case(root,16)
            self.assertEqual(chosen,expert)
            self.assertLessEqual(start,20)
            self.assertGreater(start+16,20)

    def test_wrong_case_or_geometry_never_guessed(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            a=np.ones((32,32,40),dtype=np.float32)*66
            b=np.zeros((32,32,40),dtype=np.uint8)
            b[4,5,20]=1
            save(root/"img"/"case004_image.nii.gz",a)
            save(root/"gt"/"case005_mask.nii.gz",b)
            with self.assertRaisesRegex(ValueError,"no_unambiguously"):
                mod.select_public_case(root,16)
            mask=root/"gt"/"case005_mask.nii.gz"
            mask.rename(root/"gt"/"case004_mask.nii.gz")
            aff=np.diag([.8,.8,2,1])
            aff[2,3]=6
            save(root/"gt"/"case004_mask.nii.gz",b,aff)
            with self.assertRaisesRegex(ValueError,"no_unambiguously"):
                mod.select_public_case(root,16)

    def test_blank_masks_and_missing_label_refused(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            a=np.ones((32,32,40),dtype=np.float32)*100
            b=np.zeros((32,32,40),dtype=np.uint8)
            save(root/"ct"/"subject021_scan.nii.gz",a)
            save(root/"gt"/"subject021_mask.nii.gz",b)
            with self.assertRaisesRegex(ValueError,"no_unambiguously"):
                mod.select_public_case(root,16)
            b[4,5,20]=2
            save(root/"gt"/"subject021_mask.nii.gz",b)
            with self.assertRaisesRegex(ValueError,"no_unambiguously"):
                mod.select_public_case(root,16)

    def test_pair_ids_must_not_be_image_level_similarity(self):
        self.assertFalse(mod.same_subject(Path("abc001_image.nii.gz"),Path("abc002_mask.nii.gz")))
        self.assertTrue(mod.same_subject(Path("subject_013_ct.nii.gz"),Path("subject_013_expert.nii.gz")))


if __name__=="__main__":
    unittest.main()
