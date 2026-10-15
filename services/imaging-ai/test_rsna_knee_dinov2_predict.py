"""No model download, GPU or patient data required for contract tests."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee import LABELS
from rsna_knee_dinov2_predict import prediction_ids,validate_checkpoint

class KneeDinoOfflinePredictTests(unittest.TestCase):
    def checkpoint(self):
        return {"model":"dinov2-small-mil-v1","labels":list(LABELS),
                "state_dict":{"weights":"placeholder"},"slices":3,"series_limit":3}

    def test_accepts_previous_saved_checkpoint_format(self):
        self.assertEqual(validate_checkpoint(self.checkpoint())["slices"],3)

    def test_rejects_changed_schema(self):
        item=self.checkpoint();item["labels"]=list(reversed(LABELS))
        with self.assertRaisesRegex(ValueError,"schema"):
            validate_checkpoint(item)

    def test_rejects_bad_architecture_or_preprocessing(self):
        item=self.checkpoint();item["model"]="other"
        with self.assertRaisesRegex(ValueError,"architecture"):
            validate_checkpoint(item)
        item=self.checkpoint();item["slices"]=0
        with self.assertRaisesRegex(ValueError,"preprocessing"):
            validate_checkpoint(item)

    def test_unique_study_ids(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/"studies.csv"
            with path.open("w",newline="") as f:
                writer=csv.writer(f);writer.writerow(["StudyInstanceUID"])
                writer.writerow(["case-a"]);writer.writerow(["case-b"])
            self.assertEqual(prediction_ids(path),["case-a","case-b"])
            with path.open("a",newline="") as f:
                csv.writer(f).writerow(["case-a"])
            with self.assertRaisesRegex(ValueError,"duplicate"):
                prediction_ids(path)

if __name__=="__main__":
    unittest.main()
