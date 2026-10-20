import importlib.util
import pathlib
import tempfile
import unittest

P=pathlib.Path(__file__).with_name("admit-rsna22-cspine-fracture-evidence.py")
S=importlib.util.spec_from_file_location("cspine_evidence",P)
M=importlib.util.module_from_spec(S)
S.loader.exec_module(M)

class CervicalFractureEvidence(unittest.TestCase):
    def setUp(self):
        self.d=tempfile.TemporaryDirectory()
        self.csv=pathlib.Path(self.d.name)/"author.csv"
        self.study="1.2.840.113619.2.55.3.604688433.123"
        self.kw={"exact_study_uid":self.study,
                 "original_dicom_manifest_sha":"a"*64,
                 "original_model_checkpoint_sha":"b"*64}
    def tearDown(self):
        self.d.cleanup()
    def write(self,values):
        self.csv.write_text("StudyInstanceUID,patient_overall,C1,C2,C3,C4,C5,C6,C7\n"+
                            self.study+","+values+"\n")
    def test_valid_no_identifier_or_unsupported_forward_claim(self):
        self.write("0.6,0.2,0.3,0.4,0.5,0.6,0.7,0.8")
        x=M.convert(self.csv,**self.kw)
        self.assertFalse(x["patientStudyIdentifierIncluded"])
        self.assertFalse(x["actualTrainedModelForwardIndependentlyVerified"])
        self.assertFalse(x["clinicalDiagnosisOrAbsenceConfirmed"])
        self.assertEqual(x["authorResearchProbabilities"]["C7"],0.8)
        self.assertNotIn(self.study,str(x))
    def test_reject_bad_probability(self):
        self.write("0.6,0.2,0.3,0.4,0.5,0.6,0.7,NaN")
        with self.assertRaises(ValueError): M.convert(self.csv,**self.kw)
    def test_reject_wrong_study(self):
        self.write("0.6,0.2,0.3,0.4,0.5,0.6,0.7,0.8")
        with self.assertRaises(ValueError):
            M.convert(self.csv,**{**self.kw,"exact_study_uid":"1.2.3.4"})

if __name__=="__main__":
    unittest.main()
