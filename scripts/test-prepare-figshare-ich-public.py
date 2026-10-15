#!/usr/bin/env python3
"""Synthetic CT values only, NEVER a pretrained model or actual patient scan."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

p=Path(__file__).with_name("prepare-figshare-ich-public.py")
spec=importlib.util.spec_from_file_location("opus_figshare_source",p)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class AdmittedCTContracts(unittest.TestCase):
    def fake(self,out,hu=True):
        import numpy as np
        import nibabel as nib
        rng=np.random.default_rng(324)
        img=np.full((64,64,18),-960 if hu else 40,np.float32)
        if hu:
            img[4:60,4:60,:]=rng.normal(35,13,(56,56,18))
            img[25:30,25:30,9]=220
        x=nib.Nifti1Image(img,np.diag([.8,.8,3.0,1.0]))
        x.set_sform(np.diag([.8,.8,3.,1.]),code=1)
        nib.save(x,str(out))
        return out
    def test_publisher_original_source_preserves_affine_voxels(self):
        import numpy as np
        import nibabel as nib
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            source=self.fake(root/"full.nii.gz")
            m._admit_one(source,root,0,m.sha256(source))
            original=nib.load(str(source))
            output=nib.load(str(root/"public-original-head-ct-hu-like.nii"))
            np.testing.assert_allclose(original.affine,output.affine)
            np.testing.assert_array_equal(np.asarray(original.dataobj),
                                         np.asarray(output.dataobj))
    def test_reject_unscaled_images(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            source=self.fake(root/"normalized.nii.gz",hu=False)
            with self.assertRaisesRegex(ValueError,"missing_native_hu"):
                m._admit_one(source,root,0,m.sha256(source))
    def test_disallow_full_archive_fetch_and_partial_http_200(self):
        self.assertEqual(m.ZIP_SIZE,1300209108)
        self.assertEqual(m.FILE_ID,63081925)
        with self.assertRaisesRegex(ValueError,"out_of_bounds"):
            m._remote(0,m.ZIP_SIZE-1)

if __name__=="__main__":
    unittest.main()
