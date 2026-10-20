import importlib.util
import pathlib
import unittest

MODULE=pathlib.Path(__file__).with_name("score-kits23-original-renal-tumor.py")
spec=importlib.util.spec_from_file_location("kits_renal_score",MODULE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class RenalSourceScorerContract(unittest.TestCase):
    def test_pinned_original_sources(self):
        self.assertEqual(len(mod.CT_SHA),64)
        self.assertEqual(len(mod.EXPERT_SHA),64)
        self.assertEqual(len(mod.CHECKPOINT_SHA),64)
        self.assertEqual(mod.MAX_VOXELS,230_000_000)
    def test_missing_original_files_fail_closed(self):
        with self.assertRaises(FileNotFoundError):
            mod.score("/absent/ct.nii.gz","/absent/gt.nii.gz","/absent/pred.nii.gz",
                      checkpoint_path="/absent/model.pth")

if __name__=="__main__":
    unittest.main()
