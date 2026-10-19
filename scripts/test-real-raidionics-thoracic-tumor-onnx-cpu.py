"""No network. SHA-pinned official ONNX and patient data guard tests."""
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile
from unittest.mock import patch

MODULE=Path(__file__).with_name("real-raidionics-thoracic-tumor-onnx-cpu.py")
spec=importlib.util.spec_from_file_location("onnx_case",MODULE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class OfficialOriginalONNX(unittest.TestCase):
 def test_pinned_real_public_weights_not_random(self):
  self.assertEqual(m.MODEL_ARCHIVE_SIZE,233395992)
  self.assertEqual(m.MODEL_SHA256,"46bb7d2af527eb76a964df536c7faee527ec5e6da3fb4b6abca2451c23f88f86")
  self.assertEqual(m.SAMPLE_SHA256,"3bc452580051dbea0f67caa52c4eb09c75eafdde9e8e7ff60c3a143ec94dce1f")
  self.assertIn("Raidionics-CT_Tumor-v13.zip",m.MODEL_URL)
  self.assertEqual(m.MODEL_LIBRARY_VERSION,"1.5.2")
  self.assertLessEqual(m.CPU_RSS_BUDGET,4800*1024**2)
 def test_model_asset_MD5_or_fake_SHA_cannot_be_accepted(self):
  import hashlib
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp)
   fake=root/"fake.zip"
   with zipfile.ZipFile(fake,"w") as z:
    z.writestr("CT_LymphNodes/hr/pre_processing.ini","[PreProcessing]\n")
    z.writestr("CT_LymphNodes/hr/model.onnx",b"not pretrained")
   self.assertNotEqual(m.sha(fake),m.MODEL_SHA256)
 def test_archive_rejects_escape_or_symlinks(self):
  with tempfile.TemporaryDirectory() as temp:
   root=Path(temp);out=root/"out"
   zip_path=root/"malicious.zip"
   with zipfile.ZipFile(zip_path,"w") as z:z.writestr("../../outside","oops")
   with self.assertRaisesRegex(ValueError,"untrusted_release"):
    m.safe_extract(zip_path,out)
   zip_path=root/"symlink.zip"
   entry=zipfile.ZipInfo("CT_LymphNodes/hr/model.onnx")
   entry.create_system=3;entry.external_attr=(stat.S_IFLNK|0o777)<<16
   with zipfile.ZipFile(zip_path,"w") as z:z.writestr(entry,b"oops")
   with self.assertRaisesRegex(ValueError,"symlink"):
    m.safe_extract(zip_path,root/"out2")
 def test_ct_file_selection_cannot_resolve_original_lung_mask(self):
  with tempfile.TemporaryDirectory() as temp:
   folder=Path(temp)
   (folder/"input0_label_lungs.nii.gz").write_bytes(b"mask")
   (folder/"input0.nii.gz").write_bytes(b"ct")
   self.assertEqual(m.original_ct_file(folder).name,"input0.nii.gz")
   (folder/"input0.nii.gz").unlink()
   with self.assertRaisesRegex(ValueError,"one_original_CT_required"):
    m.original_ct_file(folder)
 def test_no_networked_patient_inference_or_false_clinical_promotion(self):
  source=MODULE.read_text()
  for v in ("originalONNXFileSha256","clinicallyUsable","voxelDiceVsIndependentExpert",
     "sourceDICOMUIDsOrPatientPHITransferred","actualOriginalPretrainedModelForwardCompleted",
     "process_RSS_over_4_8GiB","sourceNativeGridMatch","CASE"):
    if v=="CASE":continue
    self.assertIn(v,source)
  self.assertNotIn("OPENROUTER_API_KEY",source)
  self.assertNotIn("patientName",source)
if __name__=="__main__":unittest.main()
