#!/usr/bin/env python3
"""Technical XRV label, source and numerical contracts; not genuine model inference."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
import numpy as np

spec=importlib.util.spec_from_file_location(
    "xrv_pneumothorax",Path(__file__).with_name("real-xrv-pneumothorax-cxr.py"))
app=importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)

class TestResearchXRV(unittest.TestCase):
    def test_valid_publisher_specific_pneumothorax_output(self):
        x=app.validate_model_output(
            ["Atelectasis","Pneumothorax","Effusion"],[0.3,0.77,0.2])
        self.assertAlmostEqual(x,.77)

    def test_untrained_or_ambiguous_output_not_silent_success(self):
        for names in (["Emphysema"],["Pneumothorax","Pneumothorax"]):
            with self.assertRaisesRegex(ValueError,"unique_pneumothorax"):
                app.validate_model_output(names,[0.2]*len(names))

    def test_invalid_score_refused(self):
        for s in (float("nan"),-0.1,1.01):
            with self.subTest(s=s):
                with self.assertRaisesRegex(ValueError,"output|score"):
                    app.validate_model_output(["Pneumothorax"],[s])

    def test_other_two_genuinely_trained_NIH_heads(self):
        labels=["Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema","Mass","Emphysema"]
        got=app.additional_trained_nih_scores(
            labels,[0.12,0.33,0.29,0.81,0.47,0.59,0.5],labels[:6])
        self.assertEqual(got,{"Cardiomegaly":0.33,"Effusion":0.29,"Pneumonia":0.81,"Edema":0.47,"Mass":0.59})

    def test_untrained_NIH_head_must_not_be_exposed(self):
        labels=["Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema","Mass"]
        with self.assertRaisesRegex(ValueError,"untrained_or_ambiguous"):
            app.additional_trained_nih_scores(labels,[.1,.4,.7,.3,.2,.1],["Pneumothorax","Cardiomegaly","Effusion","Pneumonia","Edema"])
        with self.assertRaisesRegex(ValueError,"unbounded"):
            app.additional_trained_nih_scores(labels,[.1,.4,.2,.3,.2,float("nan")],labels)

    def test_hash_binding_rejects_wrong_pretrained_checkpoint(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            image=root/"original.png"
            weights=root/app.FILENAME
            output=root/"result.json"
            image.write_bytes(b"source technical data only"*128)
            weights.write_bytes(b"fake publisher checkpoint"*700000)
            d=app.sha256(weights)
            app.validate_source(image,weights,output,d,
                "https://github.com/mlmed/torchxrayvision","NIH Clinical Center ChestXray FAQ")
            with self.assertRaisesRegex(ValueError,"SHA256"):
                app.validate_source(image,weights,output,"f"*64,
                    "https://github.com/mlmed/torchxrayvision","NIH Clinical Center ChestXray FAQ")
            with self.assertRaisesRegex(ValueError,"license"):
                app.validate_source(image,weights,output,d,
                    "https://github.com/mlmed/torchxrayvision","unlicensed")
            with self.assertRaisesRegex(ValueError,"identifier"):
                app.validate_source(image,weights,output,d,
                    "https://example.org/file?secret=abc","NIH Clinical Center ChestXray FAQ")

    def test_clinical_safety_status_in_code(self):
        code=Path(__file__).with_name("real-xrv-pneumothorax-cxr.py").read_text()
        self.assertIn('"patientUseAllowed":False',code)
        self.assertIn('"pneumothoraxSpatialLocalization":None',code)
        self.assertIn('"absenceOfDiseaseEstablished":False',code)

if __name__=="__main__":unittest.main()
