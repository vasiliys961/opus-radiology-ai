"""Test that native DICOM invokes genuine runner on the freshly converted NIfTI."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("native_monai",HERE/"analyze_chest_dicom_monai.py")
import sys
sys.path.insert(0,str(HERE))
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TestOneCommandNativeDicom(unittest.TestCase):
    def test_requires_explicit_admission(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError,"verified_public_rights"):
                mod.analyze_native_dicom(
                    dicom_folder=Path(root),bundle=Path(root),output=Path(root)/"report.json",
                    public_rights_cleared=False,deidentified_verified=True)
    def test_exact_converted_source_is_given_to_genuine_runner(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            def converter(folder,source,*,public_rights,deidentified):
                self.assertTrue(public_rights and deidentified)
                self.assertEqual(source.name,"converted-ct.nii")
                source.write_bytes(b"test")
                source.with_suffix(".admission.json").write_text("{}")
                return {"sha256":"a"*64,"admissionCreated":True}
            def genuine(source,admission,bundle,work,output,authorization):
                self.assertTrue(source.is_file())
                self.assertTrue(admission.is_file())
                self.assertEqual(authorization,mod.AUTH)
                self.assertEqual(bundle,root)
                output.write_text('{"candidates":[]}')
                return {"source":{"sha256":"a"*64},
                    "execution":{"actualPretrainedInferenceCompleted":True},
                    "candidates":[]}
            with patch.object(mod,"convert_dicom_chest",side_effect=converter),patch.object(mod,"run",side_effect=genuine):
                result=mod.analyze_native_dicom(dicom_folder=root,bundle=root,
                    output=root/"report.json",
                    public_rights_cleared=True,deidentified_verified=True)
            self.assertTrue(result["modelCompleted"])
            self.assertEqual(result["candidateCount"],0)
    def test_reject_model_source_mismatch(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            def converter(folder,source,**kwargs):
                source.write_bytes(b"x")
                source.with_suffix(".admission.json").write_text("{}")
                return {"sha256":"a"*64,"admissionCreated":True}
            with patch.object(mod,"convert_dicom_chest",side_effect=converter),patch.object(mod,"run",return_value={
                "source":{"sha256":"b"*64},
                "execution":{"actualPretrainedInferenceCompleted":True},"candidates":[] }):
                with self.assertRaisesRegex(ValueError,"model_not_run"):
                    mod.analyze_native_dicom(dicom_folder=root,bundle=root,
                        output=root/"report.json",
                        public_rights_cleared=True,deidentified_verified=True)
if __name__=="__main__":unittest.main()
