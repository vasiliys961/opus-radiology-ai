import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_kaggle_cpu import run

class CpuKaggleContract(unittest.TestCase):
    def test_generate_summary_with_zero_training(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/"train_series").mkdir()
            with (root/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID","Report",*LABELS]);w.writeheader()
                for i in range(4):
                    r={"StudyInstanceUID":str(i),"Report":"Complete ACL tear." if i%2 else "ACL is intact.","ACL":i%2}
                    w.writerow(r)
            with (root/"train_series.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID","SeriesInstanceUID"]);w.writeheader()
                for i in range(4):w.writerow({"StudyInstanceUID":str(i),"SeriesInstanceUID":"series"})
            manifest=root/"manifest.json"
            manifest.write_text(json.dumps({"train":["0","1"],"validation":["2","3"],"label_schema":list(LABELS)}))
            result=run(root,manifest,root/"out")
            self.assertEqual(result["gold_train_n"],2)
            self.assertIn("ACL",result["report_candidate_counts"])
            self.assertTrue((root/"out"/"cpu_preflight_summary.json").exists())
            self.assertNotIn("Complete ACL tear",(root/"out"/"cpu_preflight_summary.json").read_text())
if __name__=="__main__":unittest.main()
