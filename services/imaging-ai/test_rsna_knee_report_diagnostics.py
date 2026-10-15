import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_report_diagnostics import diagnostics
class DiagnosticsTests(unittest.TestCase):
    def test_aggregate_reasons_and_no_identifiers(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with (p/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i in range(4):w.writerow({"StudyInstanceUID":f"secret-{i}","ACL":str(i%2)})
            (p/"manifest.json").write_text(json.dumps({"train":["secret-0","secret-1"],"validation":["secret-2","secret-3"],"label_schema":list(LABELS)}))
            with (p/"labels.jsonl").open("w") as f:
                for i in range(4):
                    labels={label:"not_mentioned" for label in LABELS}
                    labels["ACL"]="positive" if i%2 else "negative"
                    f.write(json.dumps({"StudyInstanceUID":f"secret-{i}","labels":labels})+"\n")
            data=diagnostics(p/"train.csv",p/"manifest.json",p/"labels.jsonl")
            self.assertIn("insufficient_positive_predictions",data["classes"]["ACL"]["reasons"])
            self.assertEqual(data["classes"]["ACL"]["tp"],1)
            self.assertFalse(data["approved_for_training"])
            self.assertNotIn("secret-",json.dumps(data))
if __name__=="__main__":unittest.main()
