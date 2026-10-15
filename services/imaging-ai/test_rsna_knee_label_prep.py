import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

p=Path(__file__).with_name("rsna_knee_label_prep.py")
spec=importlib.util.spec_from_file_location("labels",p)
labels=importlib.util.module_from_spec(spec)
spec.loader.exec_module(labels)

class LabelPrepTests(unittest.TestCase):
    def test_gold_priority_unknown_and_audit(self):
        with tempfile.TemporaryDirectory() as d:
            d=Path(d)
            with (d/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*labels.LABELS])
                w.writeheader();w.writerow({"StudyInstanceUID":"gold","ACL":"1"})
                w.writerow({"StudyInstanceUID":"weak"})
            with (d/"parsed.jsonl").open("w") as f:
                for uid,acl in (("gold","negative"),("weak","positive")):
                    data={k:"not_mentioned" for k in labels.LABELS}
                    data["ACL"]=acl
                    f.write(json.dumps({"StudyInstanceUID":uid,"labels":data})+"\n")
            audit=labels.prepare(d/"train.csv",d/"parsed.jsonl",d/"out.csv")
            with (d/"out.csv").open() as f:rows=list(csv.DictReader(f))
            self.assertEqual(rows[0]["ACL"],"1")
            self.assertEqual(rows[1]["ACL"],"1")
            self.assertEqual(rows[1]["MCL"],"")
            self.assertEqual(audit["gold_audit"]["ACL"]["fn"],1)
    def test_invalid_state_fails(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/"input.jsonl"
            p.write_text(json.dumps({"StudyInstanceUID":"x","labels":{"ACL":"maybe"}}))
            with self.assertRaises(ValueError):list(labels.load_jsonl(p))
if __name__=="__main__":unittest.main()
