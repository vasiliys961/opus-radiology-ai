import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "lynos_original", Path(__file__).with_name("verify-public-lynos-positive-ct.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class RealExpertLyNoSSource(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np, self.nib = np, nib
        self.tmp = tempfile.TemporaryDirectory()
        self.ct = Path(self.tmp.name)/"original.nii.gz"
        self.gt = Path(self.tmp.name)/"expert.nii.gz"
        self.affine = np.diag([.85, .85, 1.25, 1])
        vol = np.ones((48, 48, 36), dtype=np.int16)
        labels = np.zeros(vol.shape, dtype=np.float32)
        labels[8:12, 10:14, 4:7] = 1
        labels[25:28, 28:30, 18:20] = 2
        nib.save(nib.Nifti1Image(vol, self.affine), self.ct)
        nib.save(nib.Nifti1Image(labels, self.affine), self.gt)

    def tearDown(self):
        self.tmp.cleanup()

    def test_exact_public_reference_paths_and_not_a_forward(self):
        self.assertEqual(mod.DATASET, "andreped/LyNoS")
        self.assertEqual(mod.CT, "Pat3/pat3_data.nii.gz")
        self.assertEqual(mod.EXPERT, "Pat3/pat3_labels_LymphNodes.nii.gz")
        self.assertEqual(mod.EXPECTED_SOURCE_SHA256,
                         "d918d73688c38be7550a59e881e6a72b617f4d8f4171e99b286afb89f27ce646")
        self.assertIn('"modelTrainedForwardCompleted": False', Path(mod.__file__).read_text())

    def test_original_grid_and_publisher_instance_labels(self):
        report = mod.verify_pair(self.ct, self.gt)
        self.assertEqual(report["expertPositiveVoxels"], 60)
        self.assertEqual(report["expertDistinctNonzeroLabelValues"], 2)
        self.assertTrue(report["nativePhysicalCTExpertGridMatches"])

    def test_fractional_labels_fails_instead_of_thresholding(self):
        labels = self.np.zeros((48, 48, 36), dtype=self.np.float32)
        labels[8:12, 10:14, 4:7] = .5
        self.nib.save(self.nib.Nifti1Image(labels, self.affine), self.gt)
        with self.assertRaisesRegex(ValueError, "ontology_invalid"):
            mod.verify_pair(self.ct, self.gt)

    def test_source_expert_physical_mismatch_rejected(self):
        wrong = self.affine.copy()
        wrong[2,3] += 3
        data = self.np.ones((48,48,36), dtype=self.np.uint8)
        self.nib.save(self.nib.Nifti1Image(data, wrong), self.gt)
        with self.assertRaisesRegex(ValueError, "affine_mismatch"):
            mod.verify_pair(self.ct, self.gt)


if __name__ == "__main__":
    unittest.main()
