import importlib.util
import tempfile
import unittest
from pathlib import Path
import numpy as np
import nibabel as nib
path=Path(__file__).with_name("measure-original-l1-trabecular-ct-hu.py")
spec=importlib.util.spec_from_file_location("l1",path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class OriginalL1Test(unittest.TestCase):
    def test_hu_mm_volume_and_no_diagnosis(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); a=np.diag([.7,.7,2.,1.])
            ct=np.ones((24,24,24),dtype=np.float32)*110
            mask=np.zeros(ct.shape,dtype=np.uint8)
            mask[5:17,5:17,8:12]=1
            cp=root/"source.nii.gz";mp=root/"roi.nii.gz"
            nib.save(nib.Nifti1Image(ct,a),cp)
            nib.save(nib.Nifti1Image(mask,a),mp)
            result=m.measure(cp,mp)
            self.assertEqual(result["roiVoxelCount"],576)
            self.assertEqual(result["roiHU"]["median"],110)
            self.assertAlmostEqual(result["roiVolumeMl"],.5645,places=3)
            self.assertIsNone(result["osteoporosisDiagnosis"])
            self.assertTrue(result["opportunisticAttenuationNotQCTBMD"])
            shifted=a.copy();shifted[0,3]=5
            nib.save(nib.Nifti1Image(mask,shifted),mp)
            with self.assertRaisesRegex(ValueError,"geometry"):
                m.measure(cp,mp)
if __name__=="__main__":unittest.main()
