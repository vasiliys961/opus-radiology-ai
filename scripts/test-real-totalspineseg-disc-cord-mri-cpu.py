import importlib.util
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location(
 "tss",Path(__file__).with_name("real-totalspineseg-disc-cord-mri-cpu.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OriginalTotalSpineSegContract(unittest.TestCase):
 def setUp(self):
  import nibabel as nib
  import numpy as np
  self.np,self.nib=np,nib
  self.tmp=tempfile.TemporaryDirectory()
  self.p=Path(self.tmp.name)
  self.affine=np.diag([1.,1.,2.,1.])
  mr=(np.arange(40*40*30,dtype=np.float32)%173).reshape(40,40,30)
  seg=np.zeros((40,40,30),dtype=np.uint8)
  seg[8:12,12:17,5:8]=92
  seg[8:13,12:17,14:17]=95
  seg[18:23,15:20,5:20]=1
  seg[18:23,15:20,22:27]=2
  self.mri=self.p/"original_mri.nii"
  self.mask=self.p/"step2_output.nii"
  nib.save(nib.Nifti1Image(mr,self.affine),self.mri)
  nib.save(nib.Nifti1Image(seg,self.affine),self.mask)

 def tearDown(self):
  self.tmp.cleanup()

 def test_true_native_source_disc_labels_cord_canal_and_volume(self):
  z=mod.inspect_disc_mask(self.mri,self.mask)
  discs={x["disc"]:x for x in z["discCandidates"]}
  self.assertEqual(discs["L1-L2"]["label"],92)
  self.assertAlmostEqual(discs["L1-L2"]["volumeMl"],.12,places=5)
  self.assertEqual(discs["L1-L2"]["sourceVoxelBoundsInclusive"],
                   [[8,12,5],[11,16,7]])
  self.assertFalse(discs["L2-L3"]["present"])
  self.assertTrue(discs["L2-L3"]["absenceIsNotANegativeDiagnosis"])
  self.assertGreater(z["spinalCordMaskVoxels"],0)
  self.assertGreater(z["spinalCanalMaskVoxels"],0)
  self.assertTrue(z["noSpinalCordCompressionOrStenosisAssessment"])
  self.assertEqual(mod.PUBLISHER_COMMIT,"4502d41bcb4a12e44f4be666411461ca81b02d89")

 def test_refuses_wrong_grid_and_fake_labels(self):
  shifted=self.affine.copy()
  shifted[0,3]+=3
  bad=self.p/"shift.nii"
  self.nib.save(self.nib.Nifti1Image(
   self.nib.load(str(self.mask)).get_fdata().astype(self.np.uint8),shifted),bad)
  with self.assertRaisesRegex(ValueError,"affine_mismatch"):
   mod.inspect_disc_mask(self.mri,bad)
  wrong=self.p/"fake.nii"
  self.nib.save(self.nib.Nifti1Image(
   self.np.full((40,40,30),255,dtype=self.np.uint8),self.affine),wrong)
  with self.assertRaisesRegex(ValueError,"not_official"):
   mod.inspect_disc_mask(self.mri,wrong)

 def test_original_publisher_archive_sha_is_a_hard_gate(self):
  fake=self.p/"not_publisher.zip"
  fake.write_bytes(b"untrusted models")
  with self.assertRaisesRegex(ValueError,"GitHub_release_SHA256_mismatch"):
   mod.verify_archive_and_installed_model(
    "Dataset101_TotalSpineSeg_step1",fake,self.p)
  with self.assertRaisesRegex(ValueError,"unrecognized"):
   mod.verify_archive_and_installed_model("SomeOtherNet",fake,self.p)


 def test_axial_native_disc_level_canal_class2_min_area_and_ras(self):
  import numpy as np
  ct=self.nib.load(str(self.mri))
  seg=np.asanyarray(self.nib.load(str(self.mask)).dataobj).copy()
  seg[18:21,15:19,15]=2
  seg[18:23,15:20,16]=2
  m=self.nib.Nifti1Image(np.asanyarray(ct.dataobj),self.affine)
  m.header.set_xyzt_units("mm")
  s=self.nib.Nifti1Image(seg,self.affine)
  s.header.set_xyzt_units("mm")
  axial=self.p/"verified_mm_axial.nii"
  mask=self.p/"verified_mm_mask.nii"
  self.nib.save(m,axial)
  self.nib.save(s,mask)
  z=mod.inspect_disc_mask(axial,mask)["nativeAxialCanalClass2Research"]
  self.assertTrue(z["physicalMillimetresVerified"])
  self.assertTrue(z["sameSliceCalibreMeasurementEligible"])
  levels={x["disc"]:x for x in z["lumbarDiscLevelCalibreResearch"]}
  self.assertTrue(levels["L4-L5"]["presentMatchedAxialCanalSlice"])
  self.assertEqual(levels["L4-L5"]["nativeSliceIndex"],15)
  self.assertAlmostEqual(levels["L4-L5"]["sameSliceSegmentedCanalClass2AreaMm2"],12.)
  self.assertEqual(levels["L4-L5"]["sourceNiftiRasMm"],[19.,16.5,30.])
  self.assertFalse(levels["L1-L2"]["presentMatchedAxialCanalSlice"])
  self.assertTrue(levels["L1-L2"]["noMeasurementNotEvidenceOfNormality"])
  self.assertTrue(z["notStenosisOrCompressionDiagnosis"])

 def test_unverified_physical_units_and_sagittal_plane_refuse_area(self):
  import numpy as np
  original=self.nib.load(str(self.mri))
  seg=np.asanyarray(self.nib.load(str(self.mask)).dataobj)
  z=mod.native_axial_canal_research_measurements(original,seg)
  self.assertFalse(z["sameSliceCalibreMeasurementEligible"])
  self.assertFalse(z["physicalMillimetresVerified"])
  self.assertEqual(z["lumbarDiscLevelCalibreResearch"],[])
  a=np.array([[0.,0.,2.,0.],[0.,1.,0.,0.],[1.,0.,0.,0.],[0.,0.,0.,1.]])
  sagittal=self.nib.Nifti1Image(np.ones(seg.shape,dtype=np.float32),a)
  sagittal.header.set_xyzt_units("mm")
  z=mod.native_axial_canal_research_measurements(sagittal,seg)
  self.assertTrue(z["physicalMillimetresVerified"])
  self.assertFalse(z["nativeSlicePlaneCloseToAxialRAS"])
  self.assertFalse(z["sameSliceCalibreMeasurementEligible"])

if __name__=="__main__":
 unittest.main()
