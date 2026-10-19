#!/usr/bin/env python3
"""Synthetic geometry regression only; NOT a trained-model clinical test."""
import importlib.util
import json
import unittest
import numpy as np
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "opus_aortic_caliber", Path(__file__).with_name("real-aortic-axial-caliber-ct.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class TestAorticCaliber(unittest.TestCase):
    def case(self, radius=10, spacing=1, slices=24):
        i, j = np.ogrid[:64, :64]
        disk = (i - 32)**2 + (j - 32)**2 <= radius**2
        mask = np.broadcast_to(disk[:, :, None], (64, 64, slices)).astype(np.uint8).copy()
        affine = np.diag([spacing, spacing, 2, 1.0])
        return mask, affine

    def evidence(self, mask, affine):
        arr = app.measure_axial_caliber(mask, affine)
        return app.build_evidence(
            arr, "a"*64, "b"*64, "CC BY 3.0",
            "https://www.cancerimagingarchive.net/collection/lctsc/")

    def test_large_aorta_flag_is_only_candidate(self):
        mask, affine = self.case(radius=18)
        evidence = self.evidence(mask, affine)
        self.assertTrue(evidence["possibleDilatationFlagNotDiagnosis"])
        self.assertFalse(evidence["automatedDiagnosis"])
        self.assertFalse(evidence["patientUseAllowed"])
        self.assertFalse(evidence["orthogonalCenterlineCaliperMeasured"])
        self.assertEqual(evidence["measuredSliceCount"], 24)
        self.assertEqual(evidence["maximumObservedSlice"]["centroidSourceVoxel"], [32,32,0])
        self.assertAlmostEqual(evidence["maximumObservedAxialFeretDiameterMm"], 36.0, places=3)

    def test_small_diameter_does_not_claim_normal(self):
        mask, affine = self.case(radius=10)
        evidence = self.evidence(mask, affine)
        self.assertFalse(evidence["possibleDilatationFlagNotDiagnosis"])
        self.assertFalse(evidence["absenceOfDiseaseEstablished"])

    def test_spacing_is_physical_not_pixel_count(self):
        mask, affine = self.case(radius=10, spacing=2)
        evidence = self.evidence(mask, affine)
        self.assertAlmostEqual(evidence["maximumObservedAxialFeretDiameterMm"], 40, places=3)
        self.assertTrue(evidence["possibleDilatationFlagNotDiagnosis"])

    def test_oblique_and_sheared_masks_refused(self):
        mask, affine = self.case()
        affine[2,2] = 0.4
        affine[1,2] = 2.0
        with self.assertRaisesRegex(ValueError, "non_axial_grid"):
            app.measure_axial_caliber(mask, affine)
        mask, affine = self.case()
        affine[0,1] = .5
        with self.assertRaisesRegex(ValueError, "non_axial_grid"):
            app.measure_axial_caliber(mask, affine)

    def test_empty_mask_is_not_negative(self):
        mask, affine = self.case()
        with self.assertRaisesRegex(ValueError, "no_aorta_mask"):
            app.measure_axial_caliber(np.zeros_like(mask), affine)

    def test_multilabel_and_truncated_masks_refused(self):
        mask, affine = self.case()
        mask[32,32,0] = 2
        with self.assertRaisesRegex(ValueError, "binary_integer"):
            app.measure_axial_caliber(mask, affine)
        mask, affine = self.case()
        mask[:,:,:] = 0
        mask[:,:,0] = 1
        with self.assertRaisesRegex(ValueError, "insufficient_aorta_coverage"):
            app.measure_axial_caliber(mask, affine)

    def test_no_patient_identifiers_in_report(self):
        mask, affine = self.case()
        s = json.dumps(self.evidence(mask, affine))
        self.assertNotIn("PatientName", s)
        self.assertNotIn("PatientID", s)
        self.assertNotIn("DICOM_UID", s)

    def test_unlicensed_source_refused(self):
        mask, affine = self.case()
        arr = app.measure_axial_caliber(mask, affine)
        with self.assertRaisesRegex(ValueError, "license"):
            app.build_evidence(arr, "a"*64, "b"*64, "unknown", "https://example.org")


if __name__ == "__main__":
    unittest.main()
