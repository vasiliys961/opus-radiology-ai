import importlib.util
from pathlib import Path
import tempfile
import unittest

FILE=Path(__file__).with_name("real-monai-renal-neoplasm-3phase.py")
spec=importlib.util.spec_from_file_location("renal_triphasic",FILE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class AuthenticRenalTumor(unittest.TestCase):
    def test_official_real_checkpoint_and_three_registered_phases(self):
        self.assertEqual(mod.EXPECTED_CLASS,4)
        self.assertEqual(mod.PHASES,("artery","vein","excret"))
        self.assertEqual(mod.CHECKPOINT_MD5,"164752169d98459d30592d72a3fa86f4")
        source=FILE.read_text()
        for marker in ("SegResNet", "torch.load", "weights_only=True",
                       "Orientationd", "Spacingd", "threeRegisteredPhasesUsed",
                       "out_channels=6", "channel"):
            self.assertIn(marker,source)

    def test_native_renal_neoplasm_candidates_are_not_cancer_diagnosis(self):
        import numpy as np
        x=np.zeros((12,12,12),dtype=np.uint8)
        x[3:5,4:6,7:9]=1
        a=np.diag([2.,3.,4.,1.])
        a[:3,3]=[10.,20.,30.]
        candidates=mod.kidney_tumor_candidates(x,a,minimum_voxels=4)
        self.assertEqual(len(candidates),1)
        self.assertEqual(candidates[0]["sourceVoxelBox"],[[3,4],[4,5],[7,8]])
        self.assertEqual(candidates[0]["niftiWorldCentroidMm"],[17.,33.5,60.])
        self.assertFalse(candidates[0]["renalCancerProven"])
        self.assertEqual(mod.kidney_tumor_candidates(np.zeros_like(x),a),[])
        x[0,0,0]=3
        with self.assertRaisesRegex(ValueError,"invalid_native"):
            mod.kidney_tumor_candidates(x,a)

    def test_uninstalled_publisher_weights_refused(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,"original_sechenov"):
                mod.original_checkpoint(Path(d)/"not-model.pt")


if __name__=="__main__":
    unittest.main()
