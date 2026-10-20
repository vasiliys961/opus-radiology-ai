import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "gb",Path(__file__).with_name("real-gallbladder-dense-calculus-ncct.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PositiveAnatomicalGallbladderTests(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np,self.nib=np,nib
        self.tmp=tempfile.TemporaryDirectory()
        self.p=Path(self.tmp.name)
        self.a=np.diag([1.,1.,1.5,1.])
        src=np.full((40,40,24), -20,dtype=np.int16)
        gb=np.zeros(src.shape,dtype=np.uint8)
        gb[10:28,10:28,4:18]=1
        src[gb==1]=28
        src[15:18,15:18,8:11]=240
        src[1:5,1:5,8:12]=850
        self.ct=self.p/"ct.nii.gz"
        self.mask=self.p/"gallbladder.nii.gz"
        nib.save(nib.Nifti1Image(src,self.a),self.ct)
        nib.save(nib.Nifti1Image(gb,self.a),self.mask)

    def tearDown(self):
        self.tmp.cleanup()

    def test_true_physical_candidates_inside_original_lumen(self):
        x=mod.get_candidates(self.ct,self.mask,180)
        self.assertEqual(len(x["candidates"]),1)
        lesion=x["candidates"][0]
        self.assertEqual(lesion["sourceVoxelCount"],27)
        self.assertEqual(lesion["sourceVoxelBoundsInclusive"],
                         [[15,15,8],[17,17,10]])
        self.assertAlmostEqual(lesion["candidateVolumeMm3"],40.5)
        self.assertEqual(lesion["meanOriginalHU"],240)
        self.assertTrue(x["noRadiolucentStonesCanBeExcluded"])
        self.assertFalse(x["negativeStudy"])

    def test_wrong_geometrical_mask_refused(self):
        m=self.a.copy()
        m[0,3]+=2
        wrong=self.p/"bad.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.nib.load(str(self.mask)).get_fdata().astype(self.np.uint8),m),wrong)
        with self.assertRaisesRegex(ValueError,"grid_mismatch"):
            mod.get_candidates(self.ct,wrong,180)

    def test_threshold_and_empty_anatomy_refused(self):
        with self.assertRaisesRegex(ValueError,"threshold"):
            mod.get_candidates(self.ct,self.mask,50)
        missing=self.p/"empty.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.np.zeros((40,40,24),dtype=self.np.uint8),self.a),missing)
        with self.assertRaisesRegex(ValueError,"not_negative"):
            mod.get_candidates(self.ct,missing,180)


if __name__=="__main__":
    unittest.main()
