#!/usr/bin/env python3
"""No-network model-store safety and cache tests."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from yandex_model_weights import fetch,validate

class StoreTest(unittest.TestCase):
 def setUp(self):
  self.content=b"example public model checkpoint"
  self.manifest={"modelId":"compai_model7","diskPath":"disk:/opus-models/compai/checkpoint.pth",
    "sha256":hashlib.sha256(self.content).hexdigest(),"sizeBytes":len(self.content)}
 def test_rejects_patient_or_untrusted_paths(self):
  for path in ["disk:/patients/ct.nii.gz","https://evil.example/file",
               "disk:/opus-models/../secret","disk:/opus-models/"]:
   data=dict(self.manifest,diskPath=path)
   with self.assertRaises(ValueError):validate(data)
 def test_rejects_wrong_size_or_digest(self):
  for entry in [dict(self.manifest,sizeBytes=True),dict(self.manifest,sha256="no"),
                dict(self.manifest,sizeBytes=0)]:
   with self.assertRaises(ValueError):validate(entry)
 def test_valid_cached_weights_do_not_need_network_token(self):
  with tempfile.TemporaryDirectory() as td:
   folder=Path(td);target=folder/(self.manifest["modelId"]+"-"+self.manifest["sha256"]+".weights")
   target.write_bytes(self.content)
   with patch("yandex_model_weights.signed_url",side_effect=AssertionError("network call")):
    report=fetch(self.manifest,folder,"")
   self.assertTrue(report["cached"])
 def test_invalid_existing_cache_fails_closed(self):
  with tempfile.TemporaryDirectory() as td:
   folder=Path(td);target=folder/(self.manifest["modelId"]+"-"+self.manifest["sha256"]+".weights")
   target.write_bytes(b"x"*len(self.content))
   with self.assertRaisesRegex(ValueError,"SHA256"):fetch(self.manifest,folder,"")
 def test_never_log_oauth_token(self):
  self.assertNotIn("Bearer",str(self.manifest))
if __name__=="__main__":unittest.main()
