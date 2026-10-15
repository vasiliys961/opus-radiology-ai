import csv
import json
import tempfile
import unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_bootstrap import compare

class PairedBootstrapTests(unittest.TestCase):
    def test_same_predictions_zero_delta(self):
        with tempfile.TemporaryDirectory() as td:
            d=Path(td);g=d/"gold.csv";m=d/"split.json";p=d/"pred.csv"
            ids=[f"study-{i}" for i in range(12)]
            with g.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i,uid in enumerate(ids):w.writerow({"StudyInstanceUID":uid,"ACL":i%2})
            m.write_text(json.dumps({"train":["held-out-other"],"validation":ids}))
            with p.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i,uid in enumerate(ids):w.writerow({"StudyInstanceUID":uid,**{key:(.8 if i%2 else .2) for key in LABELS}})
            report=compare(g,m,p,p,50,13)
            self.assertEqual(report["delta_second_minus_first"],0)
            self.assertEqual(report["bootstrap_paired_delta_95_percentile_interval"],[0,0])
            self.assertEqual(report["n_validation"],12)

    def test_reject_bad_iterations(self):
        with self.assertRaises(ValueError):
            compare("a","b","c","d",0)

if __name__=="__main__":
    unittest.main()
