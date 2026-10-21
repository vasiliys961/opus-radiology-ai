#!/usr/bin/env python3
"""Geometry/quantification contract fixtures, NOT trained steatosis diagnosis."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

p=Path(__file__).with_name("real-hepatic-steatosis-ncct.py")
spec=importlib.util.spec_from_file_location("hepatic_ncct_research",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class HepaticNCCTResearch(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.affine=np.diag([2.,2.,2.,1.])
        self.shape=(80,80,60)
        self.liver=np.zeros(self.shape,dtype=np.uint8)
        self.spleen=np.zeros_like(self.liver)
        self.liver[5:55,5:48,4:54]=1
        self.spleen[58:78,12:37,14:46]=1
        self.ct=np.full(self.shape,-1000,dtype=np.float32)
        self.ct[self.liver.astype(bool)]=25.
        self.ct[self.spleen.astype(bool)]=55.
        self.source=self.root/"public_original_CT.nii.gz"
        self.liver_path=self.root/"pretrained_liver_binary.nii.gz"
        self.spleen_path=self.root/"pretrained_spleen_binary.nii.gz"
        self.save(self.source,self.ct)
        self.save(self.liver_path,self.liver)
        self.save(self.spleen_path,self.spleen)

    def tearDown(self):
        self.tmp.cleanup()

    def save(self,path,array,affine=None,units="mm"):
        img=nib.Nifti1Image(array,self.affine if affine is None else affine)
        if units:
            img.header.set_xyzt_units(units)
        nib.save(img,str(path))

    def test_median_liver_spleen_and_native_area_source_sha(self):
        a=mod.inspect(self.source,self.liver_path,self.spleen_path)
        self.assertEqual(a["liverMinusSpleenMedianHU"],-30.)
        self.assertEqual(a["liverToSpleenMedianHURatio"],round(25/55,5))
        self.assertEqual(a["sourcePhysicalVoxelsMm"],[2.,2.,2.])
        self.assertEqual(a["sourceCtSha256"],mod.sha256(self.source))
        self.assertTrue(a["liverAndSpleenVoxelAndPhysicalGridMatched"])
        self.assertTrue(a["notASteatosisDiagnosis"])
        self.assertTrue(a["noHistologyOrMRI_PDFFReference"])
        self.assertGreater(a["organs"][0]["erodedSourceVoxels"],10000)

    def test_foreign_geometry_units_and_overlap_refused(self):
        shift=self.affine.copy()
        shift[0,3]=3.
        self.save(self.spleen_path,self.spleen,shift)
        with self.assertRaisesRegex(ValueError,"physical_grid"):
            mod.inspect(self.source,self.liver_path,self.spleen_path)
        self.save(self.spleen_path,self.spleen)
        self.save(self.source,self.ct,units=None)
        with self.assertRaisesRegex(ValueError,"mm"):
            mod.inspect(self.source,self.liver_path,self.spleen_path)
        self.save(self.source,self.ct)
        both=self.spleen.copy()
        both[10:15,12:15,20:25]=1
        self.save(self.spleen_path,both)
        with self.assertRaisesRegex(ValueError,"overlap"):
            mod.inspect(self.source,self.liver_path,self.spleen_path)

    def test_nonbinary_and_missing_organ_masks_refused(self):
        bad=self.spleen.copy()
        bad[60,20,20]=2
        self.save(self.spleen_path,bad)
        with self.assertRaisesRegex(ValueError,"binary"):
            mod.inspect(self.source,self.liver_path,self.spleen_path)
        self.save(self.spleen_path,np.zeros_like(self.spleen))
        with self.assertRaisesRegex(ValueError,"partial_or_implausible"):
            mod.inspect(self.source,self.liver_path,self.spleen_path)

    def test_unverified_HU_or_false_calibration_refused(self):
        changed=self.ct.copy()
        changed[10,10,10]=-1200.
        self.save(self.source,changed)
        with self.assertRaisesRegex(ValueError,"unverified_HU"):
            mod.inspect(self.source,self.liver_path,self.spleen_path)


if __name__=="__main__":
    unittest.main()
