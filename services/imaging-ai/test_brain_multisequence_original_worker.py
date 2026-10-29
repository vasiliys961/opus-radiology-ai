"""Security and exact-source MRI model contracts; not a clinical forward test."""
import unittest
from brain_multisequence_original_worker import (
 create_app,TASKS,BRATS_MODEL_SHA,ISLES_MODEL_SHA,verified_models,
)


class BrainOriginalDICOMWorkerContracts(unittest.TestCase):
 def test_reject_missing_ephemeral_local_browser_authorization_before_checkpoints(self):
  with self.assertRaisesRegex(ValueError,"token_required"):
   create_app(token="bad",origin="http://127.0.0.1:3000",
              stroke_folder="/none")
  with self.assertRaisesRegex(ValueError,"origin_required"):
   create_app(token="X"*42,origin="https://public.example",
              stroke_folder="/none")

 def test_exact_original_model_task_sequences_not_interchanged(self):
  self.assertEqual(TASKS["stroke"],("dwi","adc","flair"))
  self.assertEqual(TASKS["glioma"],("t1ce","t1","t2","flair"))
  self.assertEqual(len(BRATS_MODEL_SHA),64)
  self.assertEqual(len(ISLES_MODEL_SHA),64)
  with self.assertRaisesRegex(ValueError,"checkpoint_unverified"):
   verified_models(stroke_folder="/does-not-exist")

if __name__=="__main__":
 unittest.main()
