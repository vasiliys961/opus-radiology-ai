import importlib.util
import unittest
import tempfile
from pathlib import Path
from argparse import Namespace

PATH=Path(__file__).with_name("lungscape191-native-dicom.py")
spec=importlib.util.spec_from_file_location("lungscape_native_contract",PATH)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NativeLungscapeTest(unittest.TestCase):
    def test_requires_approved_deidentified_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            args=Namespace(dicom_folder=p,nnunet_results=p,output=p/"report.json",
                           public_rights_cleared=False,deidentified_verified=False,
                           device="cpu",fold="all")
            with self.assertRaisesRegex(ValueError,"authorized_deidentified"):
                module.execute(args)
            args.public_rights_cleared=True
            with self.assertRaisesRegex(ValueError,"authorized_deidentified"):
                module.execute(args)
    def test_never_uses_fake_forward_or_sop_projection(self):
        src=PATH.read_text()
        for token in ("convert_dicom_chest(", "runner.run(", "execute=True",
                      "trueOriginalTrainedModelForwardCompleted",
                      "originalMaskConnectedComponentsResearchOnly",
                      "sourceDICOMtoModelSopMappingVerified"):
            self.assertIn(token,src)
        self.assertNotIn("predict_fake",src)

if __name__=="__main__":unittest.main()
