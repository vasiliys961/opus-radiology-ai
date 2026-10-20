import importlib.util
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location(
 "abd",Path(__file__).with_name("real-abdomen-organ-anatomical-volumetry.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PublicAnatomicAbdomenMeasurements(unittest.TestCase):
 def setUp(self):
  import numpy as np
  import nibabel as nib
  self.np,self.nib=np,nib
  self.tmp=tempfile.TemporaryDirectory()
  self.root=Path(self.tmp.name)
  self.affine=np.diag([1.,1.,2.,1.])
  x=(np.arange(40*40*20,dtype=np.float32)%120).reshape(40,40,20)
  self.ct=self.root/"source.nii"
  nib.save(nib.Nifti1Image(x,self.affine),self.ct)
  labels={}
  liver=np.zeros((40,40,20),dtype=np.uint8)
  liver[5:17,5:18,3:13]=1
  spleen=np.zeros_like(liver)
  spleen[24:30,5:12,3:13]=1
  stomach=np.zeros_like(liver)
  stomach[20:30,23:34,5:15]=1
  labels.update(liver=liver,spleen=spleen,stomach=stomach)
  self.masks={}
  for name,data in labels.items():
   dest=self.root/(name+".nii")
   nib.save(nib.Nifti1Image(data,self.affine),dest)
   self.masks[name]=dest

 def tearDown(self):
  self.tmp.cleanup()

 def test_anatomy_masks_return_true_volume_and_ratio_not_cirrhosis(self):
  h=mod.base_module().sha256(self.ct)
  report=mod.evaluate(self.ct,list(self.masks.items()),h,
                      "https://example.test/original","CC BY 4.0")
  organs=report["organMasks"]
  self.assertAlmostEqual(organs["liver"]["anatomicalMaskVolumeMl"],3.12)
  self.assertAlmostEqual(organs["spleen"]["anatomicalMaskVolumeMl"],.84)
  self.assertEqual(report["spleenToLiverMaskVolumeRatio"],.2692)
  self.assertEqual(organs["stomach"]["sourceVoxelBoundsInclusive"],
                   [[20,23,5],[29,33,14]])
  self.assertTrue(report["noGastricTumorOrWallThickeningDiagnosis"])
  self.assertTrue(report["noSteatosisOrCirrhosisOrPortalHypertensionDiagnosis"])
  self.assertFalse(report["genuineAnatomicalModelForwardExecutedByThisScript"])

 def test_bad_mask_geometry_and_invalid_organ_refused(self):
  with self.assertRaisesRegex(ValueError,"unsupported"):
   mod.evaluate(self.ct,[("lymphnode",self.masks["liver"])],
    mod.base_module().sha256(self.ct),"https://example.test/study","CC BY 4.0")
  moved=self.affine.copy()
  moved[0,3]+=5
  wrong=self.root/"wrong.nii"
  self.nib.save(self.nib.Nifti1Image(
   self.nib.load(str(self.masks["liver"])).get_fdata().astype(self.np.uint8),moved),wrong)
  with self.assertRaisesRegex(ValueError,"source_CT_grid"):
   mod.evaluate(self.ct,[("liver",wrong)],
    mod.base_module().sha256(self.ct),"https://example.test/study","CC BY 4.0")

 def test_missing_mask_not_normal_and_sha_must_match(self):
  empty=self.root/"empty.nii"
  self.nib.save(self.nib.Nifti1Image(
   self.np.zeros((40,40,20),dtype=self.np.uint8),self.affine),empty)
  h=mod.base_module().sha256(self.ct)
  p=mod.evaluate(self.ct,[("adrenal_gland_left",empty)],h,
                 "https://example.test/study","CC BY 4.0")
  self.assertFalse(p["organMasks"]["adrenal_gland_left"]["presentMask"])
  self.assertTrue(p["organMasks"]["adrenal_gland_left"]["notNormalOrMissingOrganDiagnosis"])
  with self.assertRaisesRegex(ValueError,"SHA256"):
   mod.evaluate(self.ct,[("liver",self.masks["liver"])],"0"*64,
                "https://example.test/study","CC BY 4.0")

if __name__=="__main__":
 unittest.main()
