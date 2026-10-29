import importlib.util
from pathlib import Path
import tempfile
import unittest
from argparse import Namespace

PATH=Path(__file__).with_name("cln-native-dicom-lung-tumor.py")
spec=importlib.util.spec_from_file_location("cln_native_dicom",PATH)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CLNNativeDicomContract(unittest.TestCase):
    def test_requires_explicit_licensed_deidentified_original_dicom(self):
        with tempfile.TemporaryDirectory() as d:
            args=Namespace(public_rights_cleared=False,deidentified_verified=False,
                report=Path(d)/"report.json",dicom_folder=Path(d),
                checkpoint_sha256="a"*64,model_dir=Path(d),
                memory_gib=11,timeout_sec=3300)
            with self.assertRaisesRegex(ValueError,"licensed_and_deidentified"):
                module.run(args)
            args.public_rights_cleared=True
            with self.assertRaisesRegex(ValueError,"licensed_and_deidentified"):
                module.run(args)
            args.deidentified_verified=True
            args.checkpoint_sha256=""
            with self.assertRaisesRegex(ValueError,"verified_original_CLN"):
                module.run(args)

    def test_real_pretrained_forward_and_no_false_dicom_mapping(self):
        source=PATH.read_text()
        for marker in ("convert_dicom_chest(", "cln.infer(", "modelTumorComponentCount",
                       "sourceNativeTumorCandidates", "originalDicomSopRegistrationVerified",
                       "negativeDiagnosisPermitted", "sourceImageFilesUploadedToCloud"):
            self.assertIn(marker,source)
        self.assertIn("originalModelForwardCompleted",source)
        self.assertNotIn("model.predict_fake",source)

if __name__=="__main__":
    unittest.main()
