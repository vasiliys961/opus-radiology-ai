#!/usr/bin/env python3
"""Synthetic spatial numerics only, never evidence of a trained renal stone detector."""
import importlib.util
import unittest
from pathlib import Path
import numpy as np

spec = importlib.util.spec_from_file_location(
    "opus_renal_stones", Path(__file__).with_name("real-renal-calculus-ncct-candidates.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class TestRenalCalculusNumerics(unittest.TestCase):
    def case(self):
        ct = np.full((48, 48, 48), 45, dtype=np.int16)
        left = np.zeros(ct.shape, dtype=np.uint8)
        right = np.zeros(ct.shape, dtype=np.uint8)
        left[3:20, 5:26, 4:27] = 1
        right[27:44, 5:26, 4:27] = 1
        affine = np.diag([2., 2., 2., 1.])
        # Two candidate blobs restricted to anatomically distinct kidney regions.
        ct[8:10, 10:12, 10:12] = 600
        ct[32:34, 10:12, 10:12] = 360
        return ct, {"left":left, "right":right}, affine

    def test_two_kidney_candidates_have_native_boxes_and_hu(self):
        ct, masks, affine = self.case()
        found, coverage = app.candidates(ct, masks, affine)
        self.assertEqual(len(found), 2)
        self.assertEqual(found[0]["anatomyMaskSide"], "left")
        self.assertEqual(found[0]["sourceVoxelBox"], [[8,9],[10,11],[10,11]])
        self.assertEqual(found[0]["centroidWorldRASmm"], [17., 21., 21.])
        self.assertEqual(found[0]["candidateVolumeMm3"], 64.0)
        self.assertEqual(found[0]["voxelCount"], 8)
        self.assertFalse(found[0]["stoneDiagnosisProven"])
        self.assertEqual(coverage["right"]["denseComponentCandidateCount"],1)

    def test_missing_calculi_not_a_negative_study(self):
        ct, masks, affine = self.case()
        ct.fill(45)
        found, coverage = app.candidates(ct, masks, affine)
        self.assertEqual(found, [])
        doc = app.evidence(found, coverage, "a"*64, "b"*64, "c"*64,
                           "CC0", "https://example.org/ct", 130)
        self.assertFalse(doc["absenceOfStonesEstablished"])
        self.assertIsNone(doc["definitiveDiagnosis"])
        self.assertFalse(doc["patientUseAllowed"])
        self.assertFalse(doc["ureterEvaluated"])

    def test_not_rescaled_to_HU_refused(self):
        ct, masks, affine = self.case()
        ct = ct + 1024
        with self.assertRaisesRegex(ValueError, "uncalibrated"):
            app.candidates(ct,masks,affine)

    def test_contrast_enhancement_refused_by_kidney_median(self):
        ct, masks, affine = self.case()
        ct[masks["left"]==1] = 220
        with self.assertRaisesRegex(ValueError, "contrast_enhanced"):
            app.candidates(ct,masks,affine)

    def test_overlapping_anatomy_refused(self):
        ct, masks, affine = self.case()
        masks["right"][10,10,10] = 1
        with self.assertRaisesRegex(ValueError, "overlapping_kidney"):
            app.candidates(ct,masks,affine)

    def test_neither_a_missing_kidney_nor_mismatched_grid_is_negative(self):
        ct, masks, affine = self.case()
        masks["left"][:] = 0
        with self.assertRaisesRegex(ValueError, "missing_kidney"):
            app.candidates(ct,masks,affine)
        ct,masks,affine = self.case()
        with self.assertRaisesRegex(ValueError, "binary_mask"):
            app.candidates(ct,{"left":masks["left"][:,:,:-1], "right":masks["right"]},affine)

    def test_sparse_high_HU_outside_kidneys_excluded(self):
        ct, masks, affine = self.case()
        ct.fill(45)
        ct[24,24,24] = 1000
        found,_ = app.candidates(ct,masks,affine)
        self.assertEqual(found,[])

    def test_vascular_calcification_cannot_be_distinguished_from_stones(self):
        ct,masks,affine = self.case()
        found,cov = app.candidates(ct,masks,affine)
        report=app.evidence(found,cov,"a"*64,"b"*64,"c"*64,"CC BY 3.0","https://example.org/approved",130)
        self.assertFalse(report["vascularCalcificationExcluded"])
        self.assertFalse(report["stoneSpecificPretrainedDetector"])
        self.assertEqual(report["numberOfCandidateComponents"],2)

    def test_source_license_and_sha_required(self):
        ct,masks,affine = self.case()
        found,cov = app.candidates(ct,masks,affine)
        with self.assertRaisesRegex(ValueError, "licensed_public"):
            app.evidence(found,cov,"a"*64,"b"*64,"c"*64,"unlicensed","https://example.org",130)
        with self.assertRaisesRegex(ValueError, "SHA256"):
            app.evidence(found,cov,"a","b"*64,"c"*64,"CC0","https://example.org",130)


if __name__ == "__main__":
    unittest.main()
