import importlib.util
import tempfile
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location(
    "hip",Path(__file__).with_name("real-hip-joint-native-ct-anatomy-gap.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TrueNativeHipGeometryTests(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np,self.nib=np,nib
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.a=np.diag([1.,1.,1.5,1.])
        z=np.zeros((40,40,40),dtype=np.uint8)
        hip=z.copy()
        femur=z.copy()
        hip[10:20,10:30,10:30]=1
        femur[23:33,10:30,10:30]=1
        ct=np.ones_like(z,dtype=np.int16)*30
        self.ct=self.root/"ct.nii.gz"
        self.hip=self.root/"hip_left.nii.gz"
        self.femur=self.root/"femur_left.nii.gz"
        for p,v in ((self.ct,ct),(self.hip,hip),(self.femur,femur)):
            nib.save(nib.Nifti1Image(v,self.a),p)

    def tearDown(self):
        self.tmp.cleanup()

    def test_true_native_mm_separation_and_nonclinical_output(self):
        r=mod.compare(self.ct,self.hip,self.femur,"left","5:36,5:35,5:35")
        self.assertEqual(r["jointSide"],"left")
        self.assertEqual(r["distanceToPelvicBoneMaskMm"]["min"],4)
        self.assertGreater(r["nearestFemoralSurfaceSampleCount"],30)
        self.assertTrue(r["NOTAnArticularCartilageOrClinicalJointSpaceWidth"])
        self.assertIsNone(r["coxarthrosisDiagnosis"])
        self.assertFalse(r["genuineModelForwardByThisTool"])

    def test_misalignment_overlapping_anatomy_and_bad_roi_refused(self):
        shifted=self.a.copy()
        shifted[0,3]+=2
        wrong=self.root/"wrong.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.nib.load(str(self.hip)).get_fdata().astype(self.np.uint8),shifted),wrong)
        with self.assertRaisesRegex(ValueError,"grid_mismatch"):
            mod.compare(self.ct,wrong,self.femur,"left","5:36,5:35,5:35")
        with self.assertRaisesRegex(ValueError,"ROI_too_small"):
            mod.compare(self.ct,self.hip,self.femur,"left","5:7,5:35,5:35")

    def test_bad_side_refused(self):
        with self.assertRaisesRegex(ValueError,"side"):
            mod.compare(self.ct,self.hip,self.femur,"unknown","5:36,5:35,5:35")


if __name__=="__main__":
    unittest.main()
