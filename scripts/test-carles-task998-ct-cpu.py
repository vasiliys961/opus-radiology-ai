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


if __name__ == "__main__":
    unittest.main()
