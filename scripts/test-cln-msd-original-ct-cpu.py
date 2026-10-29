
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SRC = Path(__file__).with_name("cln-msd-original-ct-cpu.py")
spec = importlib.util.spec_from_file_location("cln_real", SRC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OriginalCLNResearchSafety(unittest.TestCase):
    def test_real_lung_tumor_components_are_source_localized(self):
        source = Path(__file__).with_name("cln-msd-original-ct-cpu.py").read_text()
        for field in ("sourceNativeTumorCandidates", "sourceNiftiRasCentroidMm",
                      "candidateVolumeMl", "sourceVoxelBoundsInclusive",
                      "expertTumorComponentsMissed", "independentLesionSensitivityValidated"):
            self.assertIn(field, source)

    def test_original_publisher_task_fold_and_cpu_only(self):
        self.assertEqual(mod.REPO, "Lab-Rasool/CLN-Segmenter-MSD-fold0")
        self.assertEqual(mod.TASK, "Dataset502_MSDLung")
        self.assertEqual(mod.REVISION, "150ec31")
        source = SRC.read_text()
        for token in ("checkpoint_best.pth", "nnUNetPlans.json",
                      "nnUNetv2_predict", '"-device", "cpu"',
                      '"--disable_tta"', '"-npp", "1"', '"-nps", "1"',
                      "sourceSHA256", "patientCloudTransfer"):
            self.assertIn(token, source)

    def test_rejects_wrong_class_or_missing_3d_plan(self):
        base = {"labels": {"background": 0, "lung_tumor": 1},
                "file_ending": ".nii.gz"}
        mod.check_publisher_metadata(base, {"configurations": {"3d_fullres": {}}})
        with self.assertRaises(ValueError):
            mod.check_publisher_metadata(
                {"labels": {"background": 0, "tumor": 3}, "file_ending": ".nii.gz"},
                {"configurations": {"3d_fullres": {}}})
        with self.assertRaisesRegex(ValueError, "3d_fullres"):
            mod.check_publisher_metadata(base, {"configurations": {"2d": {}}})

    def test_missing_public_approval_fails_before_forward(self):
        from argparse import Namespace
        with tempfile.TemporaryDirectory() as d:
            args = Namespace(approved_public_source=False, source_sha256=None,
                             ct=Path(d)/"missing.nii.gz")
            with self.assertRaisesRegex(ValueError, "public_source"):
                mod.infer(args)

    def test_no_fake_weights_on_hub_unavailable(self):
        with tempfile.TemporaryDirectory() as d:
            with patch.dict("sys.modules", {"huggingface_hub": None}):
                with self.assertRaises((ImportError, ModuleNotFoundError)):
                    mod.provision(Path(d))


if __name__ == "__main__":
    unittest.main()
