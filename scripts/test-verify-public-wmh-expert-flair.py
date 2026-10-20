import importlib.util
import tempfile
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("wmh_public",Path(__file__).with_name("verify-public-wmh-expert-flair.py"))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class OriginalPublicWMHReference(unittest.TestCase):
 def test_authentic_named_public_pair(self):
  self.assertEqual(mod.REPO,"MedOtter/wmh-segmentation")
  self.assertEqual(mod.FLAIR,"dataverse_files/test/Singapore/85/orig/FLAIR.nii.gz")
  self.assertEqual(mod.EXPERT,"dataverse_files/test/Singapore/85/wmh.nii.gz")
  self.assertNotIn("data/nii/",mod.FLAIR)
 def test_expert_positive_native_grid(self):
  import numpy as np
  import nibabel as nib
  with tempfile.TemporaryDirectory() as root:
   src=np.ones((12,12,8),dtype=np.float32)
   gt=np.zeros_like(src,dtype=np.uint8);gt[3:5,3:6,2:5]=1;gt[5,5,5]=2
   a=np.diag([1.,1.,2.,1.])
   p=Path(root)/"flair.nii.gz";q=Path(root)/"wmh.nii.gz"
   nib.save(nib.Nifti1Image(src,a),p);nib.save(nib.Nifti1Image(gt,a),q)
   result=mod.verify(p,q)
   self.assertEqual(result["expertPositiveVoxels"],18)
   self.assertEqual(result["expertOtherPathologyVoxels"],1)
   self.assertEqual(result["sourceVoxelVolumeMm3"],2)
   self.assertTrue(result["sameNativePhysicalGrid"])
 def test_wrong_expert_affine_rejected(self):
  import numpy as np
  import nibabel as nib
  with tempfile.TemporaryDirectory() as root:
   p=Path(root)/"flair.nii.gz";q=Path(root)/"wmh.nii.gz"
   a=np.eye(4);other=a.copy();other[1,3]=4
   nib.save(nib.Nifti1Image(np.ones((12,12,8)),a),p)
   nib.save(nib.Nifti1Image(np.ones((12,12,8),dtype=np.uint8),other),q)
   with self.assertRaisesRegex(ValueError,"affine"):
    mod.verify(p,q)
if __name__=="__main__":unittest.main()
