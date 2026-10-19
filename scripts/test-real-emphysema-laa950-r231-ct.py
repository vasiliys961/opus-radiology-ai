#!/usr/bin/env python3
"""Synthetic HU/geometry contracts only; no true pretrained model run."""
import importlib.util
import unittest
import numpy as np
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "laa", Path(__file__).with_name("real-emphysema-laa950-r231-ct.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class TestDensitometry(unittest.TestCase):
    def data(self):
        x = np.full((40, 40, 40), -800, dtype=np.int16)
        seg = np.zeros_like(x, dtype=np.uint8)
        seg[2:19, :, :] = 1
        seg[20:39, :, :] = 2
        x[2:19, 0:10, :] = -980
        x[20:39, 0:20, :] = -951
        affine = np.diag([3, 3, 3, 1.0])
        return x, seg, affine

    def test_bilateral_LAA950_and_explicit_nondiagnosis(self):
        x, seg, affine = self.data()
        result = app.regions(x, seg, affine)
        self.assertEqual(result[0]["r231Label"], 1)
        self.assertEqual(result[1]["r231Label"], 2)
        self.assertEqual(result[0]["lowAttenuationFractionPct"], 25)
        self.assertEqual(result[1]["lowAttenuationFractionPct"], 50)
        report = app.report(result, "a"*64, "b"*64, "CC0", "https://example.org/cases")
        self.assertIsNone(report["emphysemaDiagnosis"])
        self.assertIsNone(report["COPDDiagnosis"])
        self.assertFalse(report["patientUseAllowed"])

    def test_uncalibrated_HU_refused(self):
        x, seg, affine = self.data()
        x[4, 4, 4] = -2000
        with self.assertRaisesRegex(ValueError, "uncalibrated"):
            app.regions(x, seg, affine)

    def test_missing_lung_label_refused(self):
        x, seg, affine = self.data()
        seg[:, :, :] = 0
        seg[2:3, 2:3, 2:3] = 1
        with self.assertRaisesRegex(ValueError, "both_original_lung"):
            app.regions(x, seg, affine)

    def test_zero_fraction_cannot_rule_out_disease(self):
        x, seg, affine = self.data()
        x[:, :, :] = -800
        report = app.report(
            app.regions(x, seg, affine), "a"*64, "b"*64,
            "CC0", "https://example.org/cases")
        self.assertEqual(report["overallLowAttenuationFractionPct"], 0)
        self.assertFalse(report["noPathologyExcluded"])

    def test_other_segmentation_labels_rejected(self):
        x, seg, affine = self.data()
        seg[3, 3, 3] = 8
        with self.assertRaisesRegex(ValueError, "two_lung_labels"):
            app.regions(x, seg, affine)

    def test_non_HRCT_grid_refused(self):
        x, seg, affine = self.data()
        affine[0, 0] = 20
        with self.assertRaisesRegex(ValueError, "physical_spacing"):
            app.regions(x, seg, affine)


if __name__ == "__main__":
    unittest.main()
