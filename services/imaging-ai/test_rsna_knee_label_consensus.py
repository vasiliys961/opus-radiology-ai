import csv
import json
import tempfile
import unittest
from pathlib import Path
from rsna_knee import LABELS, read_rows
from rsna_knee_label_consensus import consensus


class ConsensusTests(unittest.TestCase):
    def test_consensus_does_not_train_on_gold_validation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);rows=[]
            for i in range(8):
                row={"StudyInstanceUID":f"case-{i}",**{l:"" for l in LABELS}}
                if i<6:
                    row["ACL"]=str(i%2)
                rows.append(row)
            gold=p/"train.csv"
            with gold.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
                w.writeheader();w.writerows(rows)
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"label_schema":list(LABELS),
                "train":[f"case-{i}" for i in range(4)],
                "validation":["case-4","case-5"]}))
            files=[]
            for name in ("a","b"):
                q=p/(name+".jsonl");files.append(q)
                with q.open("w") as f:
                    for i in range(8):
                        states={l:"not_mentioned" for l in LABELS}
                        states["ACL"]="positive" if i%2 else "negative"
                        # Two annotators disagree on case 7.
                        if i==7 and name=="b":states["ACL"]="uncertain"
                        f.write(json.dumps({"StudyInstanceUID":f"case-{i}","labels":states})+"\n")
            out=p/"combined.csv"
            result=consensus(gold,manifest,files[0],files[1],out,min_support=2)
            self.assertTrue(result["admitted"]["ACL"])
            actual={r["StudyInstanceUID"]:r for r in read_rows(out)}
            self.assertEqual(actual["case-6"]["ACL"],"0")
            self.assertEqual(actual["case-7"]["ACL"],"")
            self.assertEqual(actual["case-5"]["ACL"],"1")
            self.assertEqual(result["weak_label_cells"],1)

    def test_no_calibration_support_blocks_all_weak_targets(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);rows=[]
            for i in range(3):
                r={"StudyInstanceUID":str(i),**{l:"" for l in LABELS}}
                if i<2:r["ACL"]=str(i)
                rows.append(r)
            gold=p/"gold.csv"
            with gold.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
                w.writeheader();w.writerows(rows)
            manifest=p/"partition.json"
            manifest.write_text(json.dumps({"label_schema":list(LABELS),
                                             "train":["0"],"validation":["1"]}))
            for file in ("a.jsonl","b.jsonl"):
                with (p/file).open("w") as f:
                    for i in range(3):
                        states={l:"not_mentioned" for l in LABELS}
                        states["ACL"]="positive"
                        f.write(json.dumps({"StudyInstanceUID":str(i),"labels":states})+"\n")
            result=consensus(gold,manifest,p/"a.jsonl",p/"b.jsonl",p/"out.csv")
            self.assertFalse(result["admitted"]["ACL"])
            self.assertEqual(result["weak_label_cells"],0)


if __name__=="__main__":
    unittest.main()
