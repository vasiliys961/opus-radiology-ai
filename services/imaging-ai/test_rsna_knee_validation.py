import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee import LABELS
from rsna_knee_validation import split_ids,make_manifest,evaluate

class TestKneeValidation(unittest.TestCase):
    def test_reproducible_disjoint(self):
        rows=[{"StudyInstanceUID":f"study-{i}","ACL":str(i%2)} for i in range(30)]
        a,b=split_ids(rows,42);c,d=split_ids(rows,42)
        self.assertEqual((a,b),(c,d))
        self.assertFalse(set(a)&set(b))
        self.assertEqual(len(a)+len(b),30)
    def test_duplicate_study_rejected(self):
        with self.assertRaises(ValueError):
            split_ids([{"StudyInstanceUID":"x","ACL":"1"}]*3)
    def test_heldout_predictions_only(self):
        with tempfile.TemporaryDirectory() as t:
            path=Path(t);gold=path/"gold.csv";manifest=path/"manifest.json";pred=path/"pred.csv"
            with gold.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i in range(30):w.writerow({"StudyInstanceUID":f"study-{i}","ACL":i%2})
            m=make_manifest(gold,manifest)
            with pred.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for uid in m["validation"]:w.writerow({"StudyInstanceUID":uid,**{key:.5 for key in LABELS}})
            report=evaluate(gold,manifest,pred)
            self.assertEqual(report["n_validation"],len(m["validation"]))
            self.assertEqual(report["labels"]["MCL"]["auc"],None)
            with pred.open("a") as f:f.write("extra,"+','.join(["0.5"]*12)+"\n")
            with self.assertRaisesRegex(ValueError,"held-out"):
                evaluate(gold,manifest,pred)
if __name__=="__main__":unittest.main()
