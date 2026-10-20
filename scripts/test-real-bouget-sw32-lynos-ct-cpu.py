import importlib.util
from pathlib import Path
import tempfile
import unittest
import zipfile
from unittest.mock import patch

NAME = Path(__file__).with_name("real-bouget-sw32-lynos-ct-cpu.py")
spec = importlib.util.spec_from_file_location("real_bouget_sw32", NAME)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class RealOriginalForwardSafety(unittest.TestCase):
 def test_real_case_is_pinned_to_one_public_CT_and_original_publisher(self):
  self.assertEqual(mod.HF_DATASET, "andreped/LyNoS")
  self.assertEqual(mod.CT_FILE, "Pat3/pat3_data.nii.gz")
  self.assertEqual(mod.GT_FILE, "Pat3/pat3_labels_LymphNodes.nii.gz")
  self.assertEqual(mod.PINNED_IMAGE_SHA256,
   "d918d73688c38be7550a59e881e6a72b617f4d8f4171e99b286afb89f27ce646")
  self.assertEqual(mod.PINNED_PUBLISHER_ZIP_SHA256,
   "e00d3c83aed6ba7fc0cd376e20e4aa3ec8a672d1737a0fc41becc8d217449d72")
  self.assertEqual(mod.DOCKER_IMAGE, "dbouget/ct_mediastinal_structures_segmentation:v1")
  self.assertNotIn('DOCKER_IMAGE,"python3","main.py"',NAME.read_text())
  self.assertIn('DOCKER_IMAGE,"-i"',NAME.read_text())
  self.assertIn('"CT_Lungs" in parts',NAME.read_text())
  self.assertIn('"pre_processing.ini"',NAME.read_text())
  self.assertIn("reconstruction_method=probabilities",NAME.read_text())
  self.assertIn('(root/"output").chmod(0o1777)',NAME.read_text())
 def test_file_export_requires_actual_model_forward_not_test_mock(self):
  with tempfile.TemporaryDirectory() as d:
   # No public original data: do NOT fabricate a true result.
   with patch.object(mod, "loaded_preflight", side_effect=RuntimeError("genuine weights unavailable")):
    with self.assertRaisesRegex(RuntimeError, "genuine weights unavailable"):
     mod.run_case(Path(d))
 def test_oversized_archive_member_is_refused_before_io(self):
  with tempfile.TemporaryDirectory() as d:
   dest=Path(d)/"model.h5"
   with zipfile.ZipFile(Path(d)/"test.zip","w") as z:
    z.writestr("UNet-SW32/model.h5",b"x"*1024)
   with zipfile.ZipFile(Path(d)/"test.zip") as z:
    with self.assertRaisesRegex(ValueError, "oversized_original_model_member"):
     mod.guarded_copy_member(z,z.infolist()[0],dest,500)
   self.assertFalse(dest.exists())
 def test_selects_author_class_and_not_lung_mask_or_other_channels(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   config=root/"pre_processing.ini"
   config.write_text("[Training]\nclasses = Background, Lungs, LymphNodes # publisher classes\n")
   (root/"lynos-pat3-pred_Lungs.nii.gz").write_bytes(b"lung")
   (root/"lynos-pat3-pred_LymphNodes.nii.gz").write_bytes(b"nodes")
   (root/"lynos-pat3-pred_Other.nii.gz").write_bytes(b"other")
   label,source=mod.select_lymphnode_prediction(root,config,"lynos-pat3")
   self.assertEqual(label,"LymphNodes")
   self.assertEqual(source.name,"lynos-pat3-pred_LymphNodes.nii.gz")
 def test_refuses_absent_or_ambiguous_author_lymph_node_channel(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   config=root/"pre_processing.ini"
   config.write_text("[Training]\nclasses = Background, Lungs\n")
   (root/"lynos-pat3-pred_Lungs.nii.gz").write_bytes(b"lung")
   with self.assertRaisesRegex(ValueError,"not_uniquely_declared"):
    mod.select_lymphnode_prediction(root,config,"lynos-pat3")
   config.write_text("[Training]\nclasses = Background, LymphNodes\n")
   with self.assertRaisesRegex(ValueError,"probability_output_missing"):
    mod.select_lymphnode_prediction(root,config,"lynos-pat3")
   (root/"lynos-pat3-pred_LymphNodes.nii.gz").write_bytes(b"")
   with self.assertRaisesRegex(ValueError,"probability_output_missing"):
    mod.select_lymphnode_prediction(root,config,"lynos-pat3")
   config.write_text("[Training]\nclasses = Background, LymphNodes, Lymph_Nodes\n")
   with self.assertRaisesRegex(ValueError,"not_uniquely_declared"):
    mod.select_lymphnode_prediction(root,config,"lynos-pat3")
 def test_threshold_matches_declared_research_runtime(self):
  self.assertEqual(mod.PREDICTION_THRESHOLD,0.4)
  self.assertIn('"probabilityThreshold":PREDICTION_THRESHOLD',NAME.read_text())
 def test_docker_cpu_execution_is_explicitly_network_isolated_and_memory_capped(self):
  s=NAME.read_text()
  for needle in ['"--network","none"','"--memory","5g"','"--cpus","2"',
                 '"--pids-limit","128"','"UNet-SW32"','"wholeCTOriginalModelForwardCompleted"']:
   self.assertIn(needle,s)
if __name__=="__main__":
 unittest.main()
