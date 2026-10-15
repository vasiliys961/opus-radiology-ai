import ast
import unittest
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from rsna_knee import normalize_mr_pixel

class MRIIntensityTests(unittest.TestCase):
    def test_monochrome1_reverses(self):
        pixels=np.arange(100,dtype=np.float32).reshape(10,10)
        one=normalize_mr_pixel(pixels,SimpleNamespace(PhotometricInterpretation="MONOCHROME1"),mode="dicom")
        two=normalize_mr_pixel(pixels,SimpleNamespace(PhotometricInterpretation="MONOCHROME2"),mode="dicom")
        self.assertTrue(np.allclose(one.astype(float)+two.astype(float),255,atol=1))
    def test_legacy_ignores_monochrome(self):
        pixels=np.arange(100).reshape(10,10)
        one=normalize_mr_pixel(pixels,SimpleNamespace(PhotometricInterpretation="MONOCHROME1"))
        two=normalize_mr_pixel(pixels,SimpleNamespace(PhotometricInterpretation="MONOCHROME2"))
        np.testing.assert_array_equal(one,two)
    def test_invalid_values(self):
        with self.assertRaises(ValueError):
            normalize_mr_pixel(np.full((3,3),np.nan),SimpleNamespace(),mode="dicom")
        with self.assertRaises(ValueError):
            normalize_mr_pixel(np.ones((3,3)),SimpleNamespace(),mode="dicom")
        with self.assertRaises(ValueError):
            normalize_mr_pixel(np.arange(9).reshape(3,3),SimpleNamespace(RescaleSlope=0),mode="dicom")
    def test_checkpoint_mode_and_runners(self):
        for name in ("rsna_knee_dinov2.py","rsna_knee_coatnet.py","rsna_knee_dinov2_predict.py","rsna_knee_coatnet_predict.py","rsna_knee_compare.py"):
            source=(Path(__file__).parent/name).read_text()
            ast.parse(source)
            self.assertIn("pixel_mode",source)
if __name__=="__main__":unittest.main()
