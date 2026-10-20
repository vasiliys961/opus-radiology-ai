import importlib.util
from pathlib import Path
import tempfile
import unittest
from argparse import Namespace

SRC=Path(__file__).with_name("real-fracsegnet-v1-pelvic-fracture-gpu.py")
spec=importlib.util.spec_from_file_location("fracseg_vendor",SRC)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class GenuineFracSegNetContract(unittest.TestCase):
    def test_requires_source_checkpoint_and_isolated_GPU(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            args=Namespace(approved_public_extracted_roi=False,
                           source_sha256=None,isolated_gpu_research=False,
                           task="Task030_Pelvis",roi=root/"source.nii.gz")
            with self.assertRaisesRegex(ValueError,"approved_public_source"):
                mod.run(args)
            with self.assertRaisesRegex(ValueError,"original_FractureSegNet_weight_file"):
                mod.inspect_original_model(root/"missing.model",root,"a"*64)

    def test_no_fake_fracture_confirmation_or_patient_upload(self):
        src=SRC.read_text()
        for expected in ("nnUNet_predict", "original_patched_nnunet_v1_7_predict_missing",
                         "10GB_NVIDIA", '"fractureDiagnosisProven":False',
                         '"fullPelvicCTAutomated":False', '"diagnosisPermitted":False',
                         "source_ROI_hash_changed"):
            self.assertIn(expected,src)
        self.assertEqual(mod.AUTHOR,"https://github.com/YzzLiu/FracSegNet")


if __name__=="__main__":
    unittest.main()
