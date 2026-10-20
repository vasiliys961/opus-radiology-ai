"""Contract checks only; never count these as authentic Carles inference."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

PATH = Path(__file__).with_name("carles-task998-ct-cpu.py")
spec = importlib.util.spec_from_file_location("carles_ct_runner", PATH)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AuthenticCarlesCTContract(unittest.TestCase):
    def test_publisher_ct_task_cannot_be_pet_task(self):
        self.assertEqual(mod.TASK, "Task998_LungCTSegmentation")
        self.assertEqual(mod.TRAINER, "nnUNetTrainerV2__nnUNetPlansv2.1")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "original_CT_Task998"):
                mod.checkpoint(root, 0)
            self.assertRaisesRegex(ValueError, "unsupported_fold", mod.checkpoint, root, 8)

    def test_missing_weight_is_never_presented_as_true_forward(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            folder = root / "nnUNet" / "3d_fullres" / mod.TASK / mod.TRAINER
            (folder / "fold_0").mkdir(parents=True)
            (folder / "plans.pkl").write_bytes(b"public_source_not_inferred")
            (folder / "fold_0" / "model_final_checkpoint.model").write_bytes(b"not_real_weights")
            with self.assertRaisesRegex(ValueError, "original_CT_Task998"):
                mod.checkpoint(root, 0)
            (folder / "fold_0" / "model_final_checkpoint.model.pkl").write_bytes(b"metadata")
            self.assertEqual(mod.checkpoint(root, 0).name, "model_final_checkpoint.model")

    def test_no_fabricated_metrics_or_pet_or_cloud(self):
        source = PATH.read_text()
        for token in ("--public-research", "CUDA_VISIBLE_DEVICES",
                      "nnUNet_predict", "3d_fullres", "voxelDice",
                      "expert_tumor_mask_geometry_mismatch",
                      "original_CT_model_output_missing"):
            self.assertIn(token, source)
        self.assertNotIn('subprocess.run(["curl"', source)


    def test_native_voxel_centroid_and_world_affine_not_dicom(self):
        import nibabel as nib
        import numpy as np
        with tempfile.TemporaryDirectory() as directory:
            d = Path(directory)
            affine = np.diag([2.0, 3.0, 4.0, 1.0])
            affine[:3, 3] = [5, 7, 11]
            ct = np.full((3, 3, 3), 37, dtype=np.int16)
            mask = np.zeros((3, 3, 3), dtype=np.uint8)
            mask[1, 1, 1] = 1
            mask[2, 1, 1] = 1
            source, pred, expert = (d / f"{x}.nii.gz" for x in ("ct", "pred", "expert"))
            nib.save(nib.Nifti1Image(ct, affine), source)
            nib.save(nib.Nifti1Image(mask, affine), pred)
            nib.save(nib.Nifti1Image(mask, affine), expert)
            out = mod.inspect_mask(source, pred, expert)
            self.assertEqual(out["sourceVoxelBounds"], {
                "minInclusive": [1, 1, 1], "maxInclusive": [2, 1, 1]})
            self.assertEqual(out["sourceVoxelCentroid"], [1.5, 1.0, 1.0])
            self.assertEqual(out["niftiWorldCentroidMm"], [8.0, 10.0, 15.0])
            self.assertFalse(out["dicomLpsCoordinatesVerified"])
            self.assertEqual(out["tumorVolumeMl"], 0.048)
            self.assertEqual(out["voxelDice"], 1.0)
            nib.save(nib.Nifti1Image(np.zeros((3, 3, 3), dtype=np.uint8), affine), pred)
            empty = mod.inspect_mask(source, pred, None)
            self.assertIsNone(empty["sourceVoxelCentroid"])
            self.assertFalse(empty["negativeDiagnosis"])
            shifted = affine.copy()
            shifted[0, 3] += 2.0
            nib.save(nib.Nifti1Image(mask, shifted), pred)
            with self.assertRaisesRegex(ValueError, "source_grid"):
                mod.inspect_mask(source, pred, expert)


if __name__ == "__main__":
    unittest.main()
