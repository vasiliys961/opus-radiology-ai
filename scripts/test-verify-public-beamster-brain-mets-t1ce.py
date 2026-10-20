"""Source geometry, categorical truth and privacy boundaries for BEAMSTER."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "beamster_positive", Path(__file__).with_name("verify-public-beamster-brain-mets-t1ce.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class BeamsterTrueSource(unittest.TestCase):
    def setUp(self):
        import nibabel as nib
        import numpy as np
        self.nib, self.np = nib, np
        self.folder = tempfile.TemporaryDirectory()
        root = Path(self.folder.name)
        self.image, self.expert = root / "source.nii.gz", root / "expert.nii.gz"
        self.affine = np.diag([.8, .8, 1.2, 1])
        mri = np.ones((40, 40, 32), dtype=np.float32)
        truth = np.zeros_like(mri, dtype=np.uint8)
        truth[5:10, 7:9, 10:13] = 1
        nib.save(nib.Nifti1Image(mri, self.affine), self.image)
        nib.save(nib.Nifti1Image(truth, self.affine), self.expert)

    def tearDown(self):
        self.folder.cleanup()

    def test_real_case_paths_and_source_not_equated_to_forward(self):
        self.assertEqual(mod.REPO, "MedOtter/BEAMSTER")
        self.assertEqual(mod.CASE, "Dataset_A_001")
        self.assertTrue(mod.IMAGE.endswith("/Dataset_A_001.nii.gz"))
        self.assertTrue(mod.EXPERT.endswith("/Dataset_A_001_segm.nii.gz"))
        text = Path(mod.__file__).read_text()
        self.assertIn('"qtimPublisherPretrainedModelForwardCompleted": False', text)
        self.assertIn('"qtimRequiredSkullStripN4RegistrationZNormalizationVerified": False', text)

    def test_positive_expert_and_native_geometry(self):
        found = mod.verify(self.image, self.expert)
        self.assertEqual(found["originalExpertPositiveVoxels"], 30)
        self.assertTrue(found["imageExpertSamePlanningGrid"])
        self.assertEqual(len(found["sourceImageSHA256"]), 64)

    def test_invalid_geometry_and_fractional_label_rejected(self):
        truth = np = self.np
        bad = np.zeros((40, 40, 32), dtype=np.float32)
        bad[5:10, 7:9, 10:13] = 0.5
        self.nib.save(self.nib.Nifti1Image(bad, self.affine), self.expert)
        with self.assertRaisesRegex(ValueError, "binary_ontology"):
            mod.verify(self.image, self.expert)
        shifted = self.affine.copy()
        shifted[2, 3] = 6
        self.nib.save(self.nib.Nifti1Image(bad.astype(np.uint8), shifted), self.expert)
        with self.assertRaisesRegex(ValueError, "affine_mismatch"):
            mod.verify(self.image, self.expert)


if __name__ == "__main__":
    unittest.main()
