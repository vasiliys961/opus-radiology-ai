"""Only control plane tests, not false trained model inferences."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location("pancancer_weights",Path(__file__).with_name("verify-ks987-original-pancancer-checkpoints.py"))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class PublishedWeightSelector(unittest.TestCase):
    def test_exact_publisher_trainer_files(self):
        names=[]
        for target in mod.TASKS.values():
            folder=target+"/"+mod.TRAINER
            names.extend([folder+"/dataset.json", folder+"/plans.json",
                          folder+"/fold_0/checkpoint_best.pth"])
        for target in ("lung","kidney"):
            found=mod.select_files(names,target)
            self.assertIn(mod.TASKS[target],found["weights"])
            self.assertEqual(len(found),3)
        self.assertEqual(len(set(names)),6)
    def test_missing_or_ambiguous_publisher_bytes_fail_closed(self):
        with self.assertRaisesRegex(ValueError,"not uniquely"):
            mod.select_files([],"lung")
        p=mod.TASKS["lung"]+"/"+mod.TRAINER+"/fold_0/checkpoint_best.pth"
        with self.assertRaisesRegex(ValueError,"not uniquely"):
            mod.select_files([p,p],"lung")
    def test_without_optin_no_download_or_false_forward(self):
        o=mod.audit("lung",output=Path("/tmp/not-created-this-is-test.json"),execute=False)
        self.assertIs(o["originalWeightsDownloaded"],False)
        self.assertIs(o["actualOriginalForward"],False)
        self.assertIs(o["clinicalValidation"],False)


if __name__=="__main__":
    unittest.main()
