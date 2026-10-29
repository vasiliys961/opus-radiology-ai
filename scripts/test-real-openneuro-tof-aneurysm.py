
import importlib.util
from pathlib import Path
import tempfile
import unittest

PATH=Path(__file__).with_name("real-openneuro-tof-aneurysm.py")
spec=importlib.util.spec_from_file_location("aneurysm_source",PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OriginalAneurysmDetector(unittest.TestCase):
    def test_exact_public_TOF_reference_and_original_model_guard(self):
        self.assertEqual(mod.GIT_SHA,"8921f7b9beab038e1a314f9aab84d7358c4568c5")
        self.assertIn("sub-013",mod.SOURCE)
        self.assertTrue(mod.MASK.startswith("derivatives/manual_masks/"))
        self.assertEqual(mod.FILES["tof"][1],28579756)
        src=PATH.read_text()
        for token in ('"brain_aneurysm"', '"CC BY-NC 4.0', "original_TOF_manual_mask_shape_invalid",
                      "trainedPretrainedInferenceFinished", "voxelDiceAgainstProvidedManualMask",
                      "commercialUseOfThisModelProhibited"):
            self.assertIn(token,src)
        self.assertNotIn("patientUseAllowed\":True",src)

    def test_native_lesion_localization_and_reference_recall_contract(self):
        src=PATH.read_text()
        for name in ("nativeCentroidRASmm", "nativeVoxelBoundsInclusive",
                     "modelCandidateVolumeMl", "manualReferenceComponentsMissed",
                     "manualReferenceLesionRecallByAnyVoxelOverlap",
                     "clinicalAneurysmDiagnosisConfirmed",
                     "aneurysm_component_volumes_do_not_cover_model_mask"):
            self.assertIn(name,src)
        self.assertIn("from scipy.ndimage import label,find_objects,center_of_mass",src)

    def test_annex_checksum_check_fails_closed(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/"public.nii.gz"
            with self.assertRaises(Exception):
                mod.get_pinned_file("file:///nonexistent/aneurysm",path,42,"0"*32)
            self.assertFalse(path.exists())


if __name__=="__main__":
    unittest.main()
