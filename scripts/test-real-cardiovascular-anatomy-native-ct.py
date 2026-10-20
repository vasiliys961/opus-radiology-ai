#!/usr/bin/env python3
"""Offline numerical and provenance contracts for the cardiovascular research module."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "cardio", Path(__file__).with_name("real-cardiovascular-anatomy-native-ct.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class NativeCardiovascularTests(unittest.TestCase):
    def setUp(self):
        import nibabel as nib
        import numpy as np
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.nib = nib
        self.np = np
        self.affine = np.diag([2., 2., 3., 1.])
        ct = np.zeros((16, 16, 16), dtype=np.int16)
        self.ct = self.root/"public_ct.nii.gz"
        nib.save(nib.Nifti1Image(ct, self.affine), self.ct)
        mask = np.zeros(ct.shape, dtype=np.uint8)
        mask[4:8, 6:10, 3:8] = 1
        self.mask = self.root/"aorta.nii.gz"
        nib.save(nib.Nifti1Image(mask, self.affine), self.mask)

    def tearDown(self):
        self.temp.cleanup()

    def test_native_anatomical_count_affine_volume_centroid(self):
        report = mod.evaluate(
            self.ct, [("aorta", self.mask)], mod.sha256(self.ct),
            "https://example.test/public-licensed-ct", "CC BY 4.0")
        a = report["measurements"]["aorta"]
        self.assertEqual(a["maskVoxelCount"], 80)
        self.assertAlmostEqual(a["volumeMl"], .96, places=5)
        self.assertEqual(a["sourceVoxelBoundingBoxInclusive"], [[4, 6, 3], [7, 9, 7]])
        self.assertEqual(a["centroidRasMm"], [11., 15., 15.])
        self.assertAlmostEqual(a["candidateAxialDiameterMm"], 9.027, places=3)
        self.assertFalse(a["touchesSourceVolumeBoundary"])
        self.assertFalse(report["clinicallyValidated"])
        self.assertFalse(report["genuinePretrainedInferencePerformedByThisScript"])

    def test_empty_mask_is_not_negative(self):
        empty = self.root/"empty.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.np.zeros((16, 16, 16), dtype=self.np.uint8), self.affine), empty)
        value = mod.measure(mod.checked_image(self.ct), "heart", empty)
        self.assertTrue(value["maskEmpty"])
        self.assertFalse(value["negativeStudy"])
        self.assertIsNone(value["volumeMl"])

    def test_wrong_grid_and_multilabel_rejected(self):
        bad_grid = self.root/"bad-grid.nii.gz"
        aff = self.affine.copy()
        aff[0, 3] += 3
        self.nib.save(self.nib.Nifti1Image(
            self.np.ones((16, 16, 16), dtype=self.np.uint8), aff), bad_grid)
        with self.assertRaisesRegex(ValueError, "source_CT_grid"):
            mod.measure(mod.checked_image(self.ct), "aorta", bad_grid)
        multilabel = self.root/"multi.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.np.full((16, 16, 16), 2, dtype=self.np.uint8),
            self.affine), multilabel)
        with self.assertRaisesRegex(ValueError, "binary"):
            mod.measure(mod.checked_image(self.ct), "heart", multilabel)

    def test_sha_license_and_unsupported_model_rejected(self):
        for sha in ("0"*64, "bogus"):
            with self.assertRaises(ValueError):
                mod.evaluate(self.ct, [("aorta", self.mask)], sha,
                             "https://example.test/ct", "CC BY 4.0")
        with self.assertRaisesRegex(ValueError, "duplicate"):
            mod.evaluate(self.ct, [("heartchambers_highres", self.mask)],
                         mod.sha256(self.ct), "https://example.test/ct", "CC BY 4.0")


if __name__ == "__main__":
    unittest.main()
