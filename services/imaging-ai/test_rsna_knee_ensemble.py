import importlib.util
import csv
import tempfile
import unittest
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).parent))
import rsna_knee
spec=importlib.util.spec_from_file_location("ensemble",Path(__file__).with_name("rsna_knee_ensemble.py"))
ensemble=importlib.util.module_from_spec(spec);spec.loader.exec_module(ensemble)
class TestEnsemble(unittest.TestCase):
    def test_equal_weight_mean(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for name,prob in (("a",.2),("b",.8)):
                with (root/(name+".csv")).open("w",newline="") as f:
                    w=csv.writer(f);w.writerow(ensemble.FIELDS)
                    w.writerow(["uid",*[prob]*12])
            ensemble.merge_predictions(root/"a.csv",root/"b.csv",root/"out.csv")
            result=ensemble.read_prediction(root/"out.csv")
            self.assertAlmostEqual(result["uid"][0],.5)
    def test_mismatched_ids_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            for uid,name in (("first","a"),("second","b")):
                with (root/(name+".csv")).open("w",newline="") as f:
                    w=csv.writer(f);w.writerow(ensemble.FIELDS);w.writerow([uid,*([.4]*12)])
            with self.assertRaisesRegex(ValueError,"Study IDs"):
                ensemble.merge_predictions(root/"a.csv",root/"b.csv",root/"out.csv")
if __name__=="__main__":unittest.main()
