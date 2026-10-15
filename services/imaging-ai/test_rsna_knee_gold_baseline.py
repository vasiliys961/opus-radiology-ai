import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_gold_baseline import plan
class GoldBaselineTests(unittest.TestCase):
    def test_gold_only_dry_run(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/"train_series").mkdir()
            (root/"train_series.csv").write_text("StudyInstanceUID,SeriesInstanceUID\n")
            with (root/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i in range(4):w.writerow({"StudyInstanceUID":str(i),"ACL":i%2})
            manifest=root/"manifest.json"
            manifest.write_text(json.dumps({"train":["0","1"],"validation":["2","3"],"label_schema":list(LABELS)}))
            result=plan(root,manifest,root/"model.pt")
            self.assertEqual(result["gold_train"],2)
            self.assertFalse(result["training_started"])
            self.assertEqual(result["unreviewed_weak_labels"],0)
            self.assertIn("finding-v2",result["command"])
            with self.assertRaises(ValueError):plan(root,manifest,root/"model.pt",epochs=0)
if __name__=="__main__":unittest.main()
