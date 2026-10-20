import importlib.util
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location(
 "aortho",Path(__file__).with_name("real-aortic-centerline-orthogonal-ct.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class SourceOrthogonalAortaTests(unittest.TestCase):
 def setUp(self):
  import nibabel as nib
  import numpy as np
  self.nib,self.np=nib,np
  self.temp=tempfile.TemporaryDirectory()
  self.root=Path(self.temp.name)
  self.a=np.diag([1.,1.,1.25,1.])
  self.ct=self.root/"original_ct.nii.gz"
  nib.save(nib.Nifti1Image(np.zeros((64,64,72),dtype=np.int16),self.a),self.ct)
  x,y=np.ogrid[:64,:64]
  self.x,self.y=x,y

 def tearDown(self):
  self.temp.cleanup()

 def source_mask(self,filename,bulge=False):
  z=self.np.zeros((64,64,72),dtype=self.np.uint8)
  for k in range(8,64):
   center=24+.25*k
   rad=13 if bulge and 30<=k<40 else 8.5
   xy=(self.x-center)**2+(self.y-32)**2<rad**2
   z[:,:,k]=xy.astype(self.np.uint8)
  file=self.root/filename
  self.nib.save(self.nib.Nifti1Image(z,self.a),file)
  return file

 def test_orthogonal_diameter_tracks_physical_tilted_lumen(self):
  mask=self.source_mask("normal.nii.gz")
  result=mod.orthogonal_profile(self.ct,mask,1.)
  self.assertGreater(result["numberOfReviewedOrthogonalPlanes"],5)
  self.assertGreater(result["maximumSampledMaskFeretMm"],13.)
  self.assertLess(result["maximumSampledMaskFeretMm"],23.)
  self.assertTrue(result["measurementsAreInteriorSegmentationNotExternalWallCalipers"])
  self.assertFalse(result["clinicallyValidated"])
  self.assertFalse(result["genuineModelForwardPerformedByThisScript"])

 def test_dilated_segment_increases_measured_mask_diameter(self):
  baseline=mod.orthogonal_profile(self.ct,self.source_mask("base.nii.gz"))
  dilated=mod.orthogonal_profile(self.ct,self.source_mask("bulge.nii.gz",True))
  self.assertGreater(dilated["maximumSampledMaskFeretMm"],
                     baseline["maximumSampledMaskFeretMm"]+4)
  self.assertGreater(dilated["maximumSampledMaskAreaEquivalentDiameterMm"],
                     baseline["maximumSampledMaskAreaEquivalentDiameterMm"]+4)

 def test_mismatch_and_nonbinary_original_anatomy_refused(self):
  mask=self.source_mask("original.nii.gz")
  moved=self.a.copy()
  moved[0,3]+=3
  wrong=self.root/"shift.nii.gz"
  self.nib.save(self.nib.Nifti1Image(
   self.nib.load(str(mask)).get_fdata().astype(self.np.uint8),moved),wrong)
  with self.assertRaisesRegex(ValueError,"source_NIfTI_geometry"):
   mod.orthogonal_profile(self.ct,wrong)
  multilabel=self.root/"wronglabels.nii.gz"
  self.nib.save(self.nib.Nifti1Image(
   self.np.full((64,64,72),2,dtype=self.np.uint8),self.a),multilabel)
  with self.assertRaisesRegex(ValueError,"not_binary"):
   mod.orthogonal_profile(self.ct,multilabel)

if __name__=="__main__":
 unittest.main()
