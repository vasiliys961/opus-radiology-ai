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
    def test_binary_publisher_ontology_is_distinct_from_kits23(self):
        src=MODULE.read_text()
        self.assertIn("truth = a == 2",src)
        self.assertIn("result = b == 1",src)
        self.assertIn("not np.isin(b,[0,1]).all()",src)
        self.assertIn('"predictedTumorLabelId":1',src)

    def test_missing_original_files_fail_closed(self):
        with self.assertRaises(FileNotFoundError):
            mod.score("/absent/ct.nii.gz","/absent/gt.nii.gz","/absent/pred.nii.gz",
                      checkpoint_path="/absent/model.pth")

if __name__=="__main__":
    unittest.main()
