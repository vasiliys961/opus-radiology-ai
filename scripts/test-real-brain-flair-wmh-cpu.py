import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "wmhresearch", Path(__file__).with_name("real-brain-flair-wmh-cpu.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TrueBrainWmhBridgeContract(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np, self.nib = np, nib
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.affine = np.diag([1., 1., 2., 1.])
        image = np.arange(64*64*24, dtype=np.float32).reshape((64, 64, 24))
        self.flair = self.root/"flair.nii.gz"
        nib.save(nib.Nifti1Image(image, self.affine), self.flair)
        mask = np.zeros(image.shape, dtype=np.uint8)
        mask[5:9, 10:14, 4:7] = 1
        self.mask = self.root/"pred.nii.gz"
        nib.save(nib.Nifti1Image(mask, self.affine), self.mask)

    def tearDown(self):
        self.tmp.cleanup()

    def test_binary_original_mask_source_geometry_component_volumes(self):
        result = mod.inspect_mask(self.flair, self.mask, mod.digest(self.mask))
        self.assertEqual(result["candidateVoxelCount"], 48)
        self.assertEqual(result["candidateComponentCount"], 1)
        self.assertAlmostEqual(result["totalPredictedHyperintensityMl"], .096, places=5)
        self.assertEqual(result["candidateComponents"][0]["sourceVoxelBoundsInclusive"],
                         [[5, 10, 4], [8, 13, 6]])
        self.assertTrue(result["WMHVsMSVsOtherTissueEtiologyIndeterminate"])

    def test_geometry_mismatch_prevents_mask_use(self):
        wrong = self.affine.copy()
        wrong[1, 3] += 2
        bad = self.root/"bad.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.nib.load(str(self.mask)).get_fdata().astype(self.np.uint8),
            wrong), bad)
        with self.assertRaisesRegex(ValueError, "original_FLAIR"):
            mod.inspect_mask(self.flair, bad, mod.digest(bad))


    def test_original_expert_overlap_with_ignore_other_pathology(self):
        truth = self.np.zeros((64, 64, 24), dtype=self.np.uint8)
        truth[6:10, 10:14, 4:7] = 1
        truth[5, 10, 4] = 2  # Challenge class 2: other pathology, not normal.
        expert = self.root/"expert.nii.gz"
        self.nib.save(self.nib.Nifti1Image(truth, self.affine), expert)
        score = mod.compare_native_expert(
            self.flair, self.mask, expert, mod.digest(expert))
        self.assertEqual(score["tp"], 36)
        self.assertEqual(score["fp"], 11)
        self.assertEqual(score["fn"], 12)
        self.assertEqual(score["expertOtherPathologyLabel2ExcludedVoxels"], 1)
        self.assertAlmostEqual(score["dice"], 72/95)
        self.assertFalse(score["clinicalValidation"])
        self.assertTrue(score["singleCaseResearchScoreNotIndependentValidation"])

    def test_expert_checksum_mismatch_and_invalid_ontology_fail_closed(self):
        truth = self.np.zeros((64, 64, 24), dtype=self.np.uint8)
        truth[7:9, 10:12, 4:7] = 1
        expert = self.root/"expert.nii.gz"
        self.nib.save(self.nib.Nifti1Image(truth, self.affine), expert)
        with self.assertRaisesRegex(ValueError, "SHA256_mismatch"):
            mod.compare_native_expert(self.flair, self.mask, expert, "0"*64)
        truth[20, 20, 10] = 3
        self.nib.save(self.nib.Nifti1Image(truth, self.affine), expert)
        with self.assertRaisesRegex(ValueError, "ontology_invalid"):
            mod.compare_native_expert(self.flair, self.mask, expert, mod.digest(expert))

    def test_expert_native_affine_mismatch_fails(self):
        truth = self.np.zeros((64, 64, 24), dtype=self.np.uint8)
        truth[7:9, 10:12, 4:7] = 1
        affine = self.affine.copy()
        affine[0, 3] = 4.
        expert = self.root/"shifted.nii.gz"
        self.nib.save(self.nib.Nifti1Image(truth, affine), expert)
        with self.assertRaisesRegex(ValueError, "native_geometry_mismatch"):
            mod.compare_native_expert(self.flair, self.mask, expert, mod.digest(expert))

    def test_only_original_checkpoint_and_license_gate(self):
        with self.assertRaisesRegex(ValueError, "unprovisioned"):
            mod.original_model(self.root/"notinstalled", "0"*64)
        self.assertEqual(mod.VERSION, "1.6.0")
        self.assertEqual(mod.MODEL_REV, "a5ad55c6dec7cb2d4bd7b419a3e7d0c14e72aaee")
        source = Path(__file__).with_name("real-brain-flair-wmh-cpu.py").read_text()
        for token in ("--invivo", "--folds", "WMH_SEG_INVIVO_DIR",
                      "HF_HUB_OFFLINE", "original_model", "process_cpu",
                      "clinicallyValidated", "WMHVsMSVsOtherTissueEtiologyIndeterminate"):
            self.assertIn(token, source)


if __name__ == "__main__":
    unittest.main()
