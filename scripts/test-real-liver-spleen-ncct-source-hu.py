import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "liverhu", Path(__file__).with_name("real-liver-spleen-ncct-source-hu.py"))
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class GenuineSourceHUContracts(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np = np
        self.nib = nib
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.a = np.diag([1., 1., 1.5, 1.])
        hu = np.full((56, 56, 24), -35, dtype=np.int16)
        liver = np.zeros_like(hu, dtype=np.uint8)
        spleen = liver.copy()
        liver[4:26, 4:26, 3:21] = 1
        spleen[30:52, 30:52, 3:21] = 1
        hu[liver == 1] = 45
        hu[spleen == 1] = 65
        self.ct = self.root/"ct.nii.gz"
        self.liver = self.root/"liver.nii.gz"
        self.spleen = self.root/"spleen.nii.gz"
        for path, arr in ((self.ct, hu), (self.liver, liver), (self.spleen, spleen)):
            nib.save(nib.Nifti1Image(arr, self.a), path)

    def tearDown(self):
        self.temp.cleanup()

    def test_true_noncontrast_source_median_difference(self):
        result = mod.evaluate(self.ct, self.liver, self.spleen,
                              mod.digest(self.ct), "https://example.test/source", "CC BY 4.0")
        self.assertEqual(result["liver"]["HU"]["median"], 45)
        self.assertEqual(result["spleen"]["HU"]["median"], 65)
        self.assertEqual(result["liverMinusSpleenMedianHU"], -20)
        self.assertGreater(result["liver"]["centralInteriorROIvoxels"], 80)
        self.assertIsNone(result["steatosisDiagnosis"])
        self.assertIsNone(result["cirrhosisDiagnosis"])
        self.assertFalse(result["genuineTrainedModelForwardPerformedByThisScript"])

    def test_refuse_mask_misalignment(self):
        moved = self.a.copy()
        moved[1, 3] += 1
        bad = self.root/"wrong.nii.gz"
        self.nib.save(self.nib.Nifti1Image(self.nib.load(str(self.spleen)).get_fdata(), moved), bad)
        with self.assertRaisesRegex(ValueError, "grid_mismatch"):
            mod.evaluate(self.ct, self.liver, bad, mod.digest(self.ct),
                         "https://example.test/source", "CC BY 4.0")

    def test_original_CT_modified_and_nonbinary_mask_refused(self):
        with self.assertRaisesRegex(ValueError, "SHA256"):
            mod.evaluate(self.ct, self.liver, self.spleen, "0"*64,
                         "https://example.test/source", "CC BY 4.0")
        bad = self.root/"wrongclass.nii.gz"
        self.nib.save(self.nib.Nifti1Image(
            self.np.full((56, 56, 24), 2, dtype=self.np.uint8), self.a), bad)
        with self.assertRaisesRegex(ValueError, "binary"):
            mod.evaluate(self.ct, self.liver, bad, mod.digest(self.ct),
                         "https://example.test/source", "CC BY 4.0")


if __name__ == "__main__":
    unittest.main()
