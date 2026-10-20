
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name("cln-msd-original-positive-public-ct.py")
spec = importlib.util.spec_from_file_location("cln_public_ct", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SourceAndGenuineForwardContract(unittest.TestCase):
    def test_approved_original_MSD_case_exact_identifiers(self):
        self.assertEqual(module.DATASET, "MedOtter/msd-lung")
        self.assertEqual(module.CASE, "lung_043.nii.gz")
        self.assertEqual(module.IM, "imagesTr/lung_043.nii.gz")
        self.assertEqual(module.GT, "labelsTr/lung_043.nii.gz")

    def test_source_only_never_claims_a_trained_forward(self):
        with patch.object(module, "get_public_case", return_value={
                "dataset": module.DATASET, "revision": "a" * 40,
                "ctSHA256": "c" * 64, "expertSHA256": "e" * 64,
                "expertPositiveVoxels": 231}):
            x = module.run(Path("/not-used"), "source", 6, 60)
            self.assertEqual(x["expertPositiveVoxels"], 231)
            self.assertFalse(x["realOriginalModelForwardCompleted"])
            self.assertFalse(x["independentValidation"])
            self.assertFalse(x["clinicallyValidated"])
            self.assertNotIn("voxelDice", x)

    def test_real_CLI_and_expert_requirements_protected(self):
        s = SOURCE.read_text()
        for expected in ("mod.provision", "mod.infer", "get_public_case",
                         '"expert": saved["expert"]', "public_MSD_source_exceeds_limit",
                         "original_MSD_tumor_labels_not_binary",
                         "source_sha256", "clinicallyValidated"):
            self.assertIn(expected, s)


if __name__ == "__main__":
    unittest.main()
