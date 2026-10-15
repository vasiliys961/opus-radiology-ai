import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_report_lexicon import profile

class LexiconTests(unittest.TestCase):
    def test_counts_and_holdout_and_no_text_leak(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            with (p/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID","Report",*LABELS]);w.writeheader()
                for i in range(4):
                    w.writerow({"StudyInstanceUID":f"id-{i}","Report":"Synovial thickening SECRET" if i==0 else "No injury","Synovitis":"1" if i%2==0 else "0"})
            (p/"manifest.json").write_text(json.dumps({"train":["id-0","id-1"],"validation":["id-2","id-3"],"label_schema":list(LABELS)}))
            with (p/"labels.jsonl").open("w") as f:
                for i in range(4):
                    labels={k:"not_mentioned" for k in LABELS}
                    f.write(json.dumps({"StudyInstanceUID":f"id-{i}","labels":labels})+"\n")
            result=profile(p/"train.csv",p/"manifest.json",p/"labels.jsonl")
            self.assertEqual(result["gold_train_n"],2)
            self.assertEqual(result["gold_train_coverage"]["Synovitis"]["abstained_with_anatomy_term"],1)
            self.assertNotIn("SECRET",json.dumps(result))
            self.assertNotIn("id-0",json.dumps(result))
if __name__=="__main__":unittest.main()
