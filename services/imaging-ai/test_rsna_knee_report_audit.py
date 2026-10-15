import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_report_audit import audit,wilson_lower

class ReportAuditTests(unittest.TestCase):
    def test_wilson_support(self):
        self.assertEqual(wilson_lower(0,0),0)
        self.assertLess(wilson_lower(2,2),.5)
        self.assertGreater(wilson_lower(100,100),.95)
    def test_holdout_excluded_and_no_auto_admission(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);gold=root/"train.csv"
            with gold.open("w",newline="") as f:
                writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
                writer.writeheader()
                for i in range(4):
                    writer.writerow({"StudyInstanceUID":str(i),"ACL":str(i%2)})
            manifest=root/"manifest.json"
            manifest.write_text(json.dumps({"label_schema":list(LABELS),
                "train":["0","1"],"validation":["2","3"]}))
            labels=root/"candidate.jsonl"
            with labels.open("w") as f:
                for i in range(4):
                    evidence={k:"not_mentioned" for k in LABELS}
                    evidence["ACL"]="positive" if i%2 else "negative"
                    f.write(json.dumps({"StudyInstanceUID":str(i),"labels":evidence})+"\n")
            result=audit(gold,manifest,labels)
            self.assertEqual(result["gold_train_n"],2)
            self.assertEqual(result["classes"]["ACL"]["counts"]["tp"],1)
            self.assertFalse(result["classes"]["ACL"]["eligible_for_review"])
    def test_refuse_invalid_threshold(self):
        with self.assertRaises(ValueError):
            audit("x","y","z",minimum_support=0)
if __name__=="__main__":unittest.main()
