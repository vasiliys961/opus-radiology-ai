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
