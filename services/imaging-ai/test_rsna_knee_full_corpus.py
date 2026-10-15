import csv
import json
import tempfile
import unittest
from pathlib import Path
from rsna_knee import LABELS, read_rows
from rsna_knee_full_corpus import build
from rsna_knee_validation import load_partition


class FullCorpusTests(unittest.TestCase):
    def test_gold_holdout_and_unknown_labels(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            original=root/"gold.csv";weak=root/"weak.csv"
            rows=[];pseudo=[]
            for i in range(4):
                uid=f"study-{i}"
                base={"StudyInstanceUID":uid,**{x:"" for x in LABELS}}
                if i<3:base["ACL"]=str(i%2)
                rows.append(base)
                candidate=dict(base)
                candidate["ACL"]="1"
                candidate["MCL"]="1" if i==3 else ""
                pseudo.append(candidate)
            for path,values in ((original,rows),(weak,pseudo)):
                with path.open("w",newline="") as f:
                    w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
                    w.writeheader();w.writerows(values)
            partition=root/"partition.json"
            partition.write_text(json.dumps({"label_schema":list(LABELS),
                                             "train":["study-0","study-1"],
                                             "validation":["study-2"]}))
            out=root/"combined.csv";meta=root/"combined.json"
            summary=build(original,weak,partition,out,meta)
            self.assertEqual(summary,{"train":3,"gold_validation":1,"weak_training":1})
            result={r["StudyInstanceUID"]:r for r in read_rows(out)}
            self.assertEqual(result["study-0"]["ACL"],"0")
            self.assertEqual(result["study-2"]["ACL"],"0")
            self.assertEqual(result["study-2"]["MCL"],"")
            self.assertEqual(result["study-3"]["ACL"],"1")
            training,validation=load_partition(read_rows(out),meta)
            self.assertEqual({r["StudyInstanceUID"] for r in validation},{"study-2"})
            self.assertEqual(len(training),3)

    def test_rejects_overlap(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            rows=[{"StudyInstanceUID":str(i),**{key:("1" if key=="ACL" else "") for key in LABELS}} for i in range(3)]
            for name in ("gold.csv","weak.csv"):
                with (root/name).open("w",newline="") as f:
                    w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
                    w.writeheader();w.writerows(rows)
            m=root/"manifest.json"
            m.write_text(json.dumps({"label_schema":list(LABELS),"train":["0","1"],"validation":["1","2"]}))
            with self.assertRaises(ValueError):
                build(root/"gold.csv",root/"weak.csv",m,root/"out.csv",root/"out.json")


if __name__=="__main__":
    unittest.main()
