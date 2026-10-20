#!/usr/bin/env python3
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "lumbar", Path(__file__).with_name("real-lumbar-opportunistic-native-ct-hu.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class BoneResearchTests(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np, self.nib = np, nib
        self.temp = tempfile.TemporaryDirectory()
        self.p = Path(self.temp.name)
        self.affine = np.diag([1., 1., 1.5, 1.])
        ct = np.full((32, 32, 24), 118, dtype=np.int16)
        self.ct = self.p/"licensed_ct.nii.gz"
        nib.save(nib.Nifti1Image(ct, self.affine), self.ct)
        mask = np.zeros_like(ct, dtype=np.uint8)
        mask[8:24, 8:24, 4:20] = 1
        self.mask = self.p/"vertebrae_L2.nii.gz"
        nib.save(nib.Nifti1Image(mask, self.affine), self.mask)

    def tearDown(self):
        self.temp.cleanup()

    def test_real_physical_roi_HU_not_DXA(self):
        out = mod.evaluate(self.ct, [("L2", self.mask)],
                           mod.digest(self.ct), "https://example.test/ct", "CC BY 4.0")
        x = out["measures"]["L2"]
        self.assertEqual(x["attenuationHU"]["median"], 118)
        self.assertEqual(x["attenuationHU"]["mean"], 118)
        self.assertGreater(x["sourceCentralRoiVoxelCount"], 80)
        self.assertIsNone(x["DXATscore"])
        self.assertIsNone(x["osteoporosisDiagnosis"])
        self.assertFalse(out["clinicallyValidated"])
        self.assertFalse(out["genuineModelInferencePerformed"])

    def test_misaligned_masks_rejected(self):
        moved = self.affine.copy()
        moved[1, 3] += 1
        wrong = self.p/"wrong.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.nib.load(str(self.mask)).get_fdata().astype(self.np.uint8),
            moved), wrong)
        with self.assertRaisesRegex(ValueError, "geometry_mismatch"):
            mod.measure_one(*mod.load_img(self.ct), wrong, "L2")

    def test_abnormal_source_and_wrong_level_refused(self):
        with self.assertRaisesRegex(ValueError, "digest_mismatch"):
            mod.evaluate(self.ct, [("L2", self.mask)], "0"*64,
                         "https://example.test/ct", "CC BY 4.0")
        with self.assertRaisesRegex(ValueError, "unsupported"):
            mod.evaluate(self.ct, [("T7", self.mask)], mod.digest(self.ct),
                         "https://example.test/ct", "CC BY 4.0")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            mod.evaluate(self.ct, [("L1", self.mask), ("L1", self.mask)],
                         mod.digest(self.ct), "https://example.test/ct", "CC BY 4.0")


if __name__ == "__main__":
    unittest.main()
