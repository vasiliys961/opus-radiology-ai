#!/usr/bin/env python3
"""Source-grid and privacy contracts for zero-mask SAMIHS research diagnosis.

Generated arrays only. No patient files, upstream weights or model execution.
"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import nibabel as nib
import numpy as np


ROOT = Path(__file__).resolve().parent


def load(script, name):
    spec = importlib.util.spec_from_file_location(name, ROOT / script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pilot = load("run-ich-samihs-cpu-pilot.py", "pilot_ich_evidence")
evaluator = load("evaluate-ich-public-mask.py", "ich_evaluator")


class SAMIHSZeroMaskEvidence(unittest.TestCase):
    def make_native(self, arr, affine=None, dtype=None):
        if affine is None:
            affine = np.diag([1., 1., 2., 1.])
        nii = nib.Nifti1Image(np.asarray(arr, dtype=dtype), affine)
        nii.set_sform(affine, code=1)
        nii.set_qform(affine, code=1)
        nii.header.set_xyzt_units(xyz="mm")
        return nii

    def test_anonymous_intensity_range_and_expert_signal(self):
        ct = np.arange(8 * 8 * 4, dtype=np.float32).reshape((8, 8, 4))
        mask = np.zeros_like(ct, dtype=np.uint8)
        mask[1:3, 1:3, 1] = 1
        result = pilot.summarize_stored_intensities(
            self.make_native(ct), self.make_native(mask))
        self.assertFalse(result["valuesAreHounsfieldUnits"])
        self.assertEqual(result["sliceCount"], 4)
        self.assertEqual(result["nearConstantSourceSlices"], 0)
        self.assertIsNotNone(result["expertPositivePercentilesP005P50P995"])
        self.assertNotIn("pixelData", result)
        self.assertNotIn("filename", result)

    def test_anonymous_intensity_near_constant_slices(self):
        ct = np.zeros((8, 8, 4), np.float32)
        ct[:, :, 1] = 2.5
        mask = np.zeros_like(ct, dtype=np.uint8)
        v = pilot.summarize_stored_intensities(
            self.make_native(ct), self.make_native(mask))
        self.assertEqual(v["nearConstantSourceSlices"], 4)
        self.assertIsNone(v["expertPositivePercentilesP005P50P995"])

    def test_bad_vendor_mask_cannot_be_accepted_as_native_prediction(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = self.make_native(np.zeros((8, 8, 4), np.float32))
            output = root / "pred.nii.gz"
            nib.save(self.make_native(np.zeros((8, 8, 4), np.uint8)), str(output))
            self.assertFalse(pilot.read_binary_native_prediction(output, source).any())
            nib.save(self.make_native(np.full((8, 8, 4), 2, np.uint8)), str(output))
            with self.assertRaisesRegex(ValueError, "must_be_binary"):
                pilot.read_binary_native_prediction(output, source)
            mismatch = np.diag([1., 1., 3., 1.])
            nib.save(self.make_native(np.zeros((8, 8, 4), np.uint8), mismatch), str(output))
            with self.assertRaisesRegex(ValueError, "native_ct_slab"):
                pilot.read_binary_native_prediction(output, source)

    def test_true_0p1_vendor_threshold_probe_compares_expert_and_cleans_up(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ct = self.make_native(np.zeros((8, 8, 4), np.float32))
            expert = np.zeros((8, 8, 4), dtype=bool)
            expert[2, 2, 2] = True
            primary = root / "original-zero-prediction.nii.gz"
            nib.save(self.make_native(np.zeros_like(expert, np.uint8)), str(primary))
            digest = pilot.sha256_file(primary)
            cmd = ["python", "vendor.py", "--input", str(root / "input.nii.gz"),
                   "--output", str(primary), "--device", "cpu",
                   "--batch-size", "1", "--threshold", "0.5", "--slice-axis", "2"]
            calls = []
            def fake_invoke(command, model_dir, timeout, operator_authorized_legacy_pickle=False):
                calls.append((list(command), timeout, operator_authorized_legacy_pickle))
                self.assertEqual(command[command.index("--threshold") + 1], "0.1")
                dest = Path(command[command.index("--output") + 1])
                npred = np.zeros((8, 8, 4), dtype=np.uint8)
                npred[2, 2, 2] = 1
                npred[4, 4, 1] = 1
                nib.save(self.make_native(npred), str(dest))
            with patch.object(pilot, "invoke_verified_upstream", side_effect=fake_invoke):
                res = pilot.probe_empty_mask_threshold(
                    cmd, root, ct, expert, .002, evaluator, 120, True, primary)
            self.assertEqual(len(calls), 1)
            self.assertTrue(calls[0][2])
            self.assertEqual(res["status"], "executed")
            self.assertEqual(res["threshold"], .1)
            self.assertEqual(res["predictedPositiveVoxels"], 2)
            self.assertEqual(res["metrics"]["truePositiveVoxels"], 1)
            self.assertEqual(res["metrics"]["falsePositiveVoxels"], 1)
            self.assertEqual(res["metrics"]["falseNegativeVoxels"], 0)
            self.assertAlmostEqual(res["metrics"]["dice"], 2/3)
            self.assertEqual(pilot.sha256_file(primary), digest)
            self.assertFalse((root / "samihs-threshold-0p1-research-only.nii.gz").exists())

    def test_private_probe_cleanup_even_on_model_failure(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            ct = self.make_native(np.zeros((8, 8, 4), np.float32))
            primary = root / "first.nii.gz"
            with patch.object(pilot, "invoke_verified_upstream",
                              side_effect=RuntimeError("private traceback with source path")):
                with self.assertRaises(RuntimeError):
                    pilot.probe_empty_mask_threshold(
                        ["python", "vendor.py", "--output", str(primary),
                         "--threshold", "0.5"],
                        root, ct, np.zeros((8, 8, 4), bool),
                        .002, evaluator, 120, True, primary)
            self.assertFalse((root / "samihs-threshold-0p1-research-only.nii.gz").exists())


if __name__ == "__main__":
    unittest.main()
