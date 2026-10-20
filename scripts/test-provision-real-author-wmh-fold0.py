import importlib.util
import types
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("wmh_provision",Path(__file__).with_name("provision-real-author-wmh-fold0.py"))
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class OriginalPublisherProvenance(unittest.TestCase):
 def test_no_neural_runtime_import_for_source_package_assets(self):
  s=Path(__file__).with_name("provision-real-author-wmh-fold0.py").read_text()
  self.assertIn("distribution(\"wmh_seg\").locate_file",s)
  self.assertNotIn("importlib.resources.files",s)
 def test_author_reference(self):
  self.assertEqual(mod.REPO,"jil202/wmh_seg")
  self.assertEqual(mod.WEIGHT,"checkpoint_final_0_invivo.pth")
 def test_author_metadata_verified(self):
  entry=types.SimpleNamespace(rfilename=mod.WEIGHT,size=252000000,lfs={"sha256":"a"*64})
  data=types.SimpleNamespace(sha="c"*40,siblings=[entry])
  r=mod.manifest_for_metadata(data)
  self.assertEqual(r["publisherLfsSHA256"],"a"*64)
  self.assertFalse(r["realForwardCompleted"])
  self.assertFalse(r["originalWeightDownloadVerified"])
 def test_missing_and_unbounded_refused(self):
  for item in [types.SimpleNamespace(rfilename="unrelated",size=9,lfs={"sha256":"a"*64}),types.SimpleNamespace(rfilename=mod.WEIGHT,size=600000000,lfs={"sha256":"a"*64}),types.SimpleNamespace(rfilename=mod.WEIGHT,size=200000000,lfs=None)]:
   with self.assertRaises(ValueError):
    mod.manifest_for_metadata(types.SimpleNamespace(sha="c"*40,siblings=[item]))
if __name__=="__main__":unittest.main()
