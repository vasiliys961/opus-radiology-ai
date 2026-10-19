#!/usr/bin/env python3
"""Geometry/label contract tests are synthetic. NEVER claim real trained inference."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

src = Path(__file__).with_name("real-pelvic-fracsegnet-fragment-evidence.py")
spec = importlib.util.spec_from_file_location("opus_pelvic_fragments", src)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class PelvisEvidenceTests(unittest.TestCase):
    def case(self):
        labels = np.zeros((32, 32, 32), dtype=np.uint8)
        labels[3:10, 3:10, 3:10] = 1
        labels[11:14, 3:9, 3:9] = 2
        labels[18:25, 3:10, 3:10] = 11
        labels[18:24, 18:25, 3:10] = 21
        return labels, np.diag([1.5, 1.5, 2., 1.])

    def test_fragment_localization_and_multiple_sacral_segments(self):
        labels, affine = self.case()
        fragments, coverage = app.fragment_components(labels, affine)
        self.assertEqual(len(fragments), 4)
        self.assertEqual(coverage["sacrum"]["significantFragmentCount"], 2)
        self.assertTrue(coverage["sacrum"]["multiFragmentReviewCandidate"])
        self.assertFalse(coverage["left_hipbone"]["multiFragmentReviewCandidate"])
        self.assertEqual(fragments[0]["sourceVoxelBox"], [[3,9], [3,9], [3,9]])
        self.assertEqual(fragments[0]["centroidWorldRASmm"], [9., 9., 12.])
        self.assertFalse(coverage["right_hipbone"]["negativeFractureScreen"])

    def test_reference_dice_matches_relabelled_instances(self):
        labels, affine = self.case()
        altered = labels.copy()
        altered[labels == 1] = 2
        altered[labels == 2] = 1
        score = app.expert_comparison(altered, labels, affine)
        self.assertEqual(score["sacrum"]["foregroundBoneUnionDice"], 1.)
        self.assertEqual(len(score["sacrum"]["pairedFragmentInstanceDice"]), 2)
        self.assertTrue(all(v["instanceDice"] == 1 for v in score["sacrum"]["pairedFragmentInstanceDice"]))

    def test_invalid_label_or_mismatched_geometry_refused(self):
        labels, affine = self.case()
        app.check_label_volume(labels, affine, labels.shape, affine)
        labels[0, 0, 0] = 31
        with self.assertRaisesRegex(ValueError, "label_encoding"):
            app.check_label_volume(labels, affine, labels.shape, affine)
        labels[0, 0, 0] = 0
        other_affine = affine.copy()
        other_affine[0, 3] += 2
        with self.assertRaisesRegex(ValueError, "physical_grid"):
            app.check_label_volume(labels, other_affine, labels.shape, affine)

    def test_empty_cannot_exclude_fracture(self):
        labels, affine = self.case()
        labels.fill(0)
        with self.assertRaisesRegex(ValueError, "empty_fragment"):
            app.fragment_components(labels, affine)

    def test_output_never_claims_validation_or_patient_use(self):
        labels, affine = self.case()
        fragments, coverage = app.fragment_components(labels, affine)
        result = app.build_evidence(fragments, coverage, source_sha="a"*64,
                                    mask_sha="b"*64, ref_sha=None,
                                    source_license="CC BY-NC-SA 4.0",
                                    origin=app.DATA, comparison=None)
        self.assertFalse(result["realPretrainedModelExecutedInThisAdapter"])
        self.assertFalse(result["fractureDiagnosticAccuracyEstablished"])
        self.assertFalse(result["absenceOfFractureEstablished"])
        self.assertFalse(result["patientUseAllowed"])
        self.assertNotIn("PatientName", json.dumps(result))

    def test_requires_verified_public_rights_and_hash(self):
        labels, affine = self.case()
        f, c = app.fragment_components(labels, affine)
        with self.assertRaisesRegex(ValueError, "approved_PENGWIN"):
            app.build_evidence(f, c, source_sha="a"*64, mask_sha="b"*64,
                               ref_sha=None, source_license="unknown",
                               origin=app.DATA, comparison=None)
        with self.assertRaisesRegex(ValueError, "SHA256"):
            app.build_evidence(f, c, source_sha="a"*12, mask_sha="b"*64,
                               ref_sha=None, source_license="CC BY 4.0",
                               origin=app.DATA, comparison=None)

    def test_actual_nifti_file_roundtrip_and_hash(self):
        labels, affine = self.case()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ct = root/"ct.nii.gz"
            mask = root/"fragments.nii.gz"
            out = root/"report.json"
            source_img = nib.Nifti1Image(np.full(labels.shape, 100, dtype=np.int16), affine)
            source_img.header.set_xyzt_units("mm")
            mask_img = nib.Nifti1Image(labels, affine)
            mask_img.header.set_xyzt_units("mm")
            nib.save(source_img, str(ct))
            nib.save(mask_img, str(mask))
            result = app.run(ct, mask, out, "CC BY 4.0")
            self.assertEqual(result["sourceMaskSHA256"], app.sha256(mask))
            self.assertEqual(result["fragmentComponents"][0]["fragmentLabel"], 1)
            self.assertTrue(out.is_file())
            self.assertEqual(json.loads(out.read_text())["schema"], app.SCHEMA)


if __name__ == "__main__":
    unittest.main()
