import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_corpus_partitions import partition

class PartitionTests(unittest.TestCase):
    def test_gold_split_and_unlabeled_pool(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            with (p/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID","Report",*LABELS]);w.writeheader()
                for i in range(6):
                    w.writerow({"StudyInstanceUID":str(i),"ACL":str(i%2) if i<4 else "",
                                "Report":"secret report"})
            with (p/"train_series.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID","SeriesInstanceUID"]);w.writeheader()
                for i in range(6):w.writerow({"StudyInstanceUID":str(i),"SeriesInstanceUID":"x"})
            manifest=p/"manifest.json"
            manifest.write_text(json.dumps({"train":["0","1","2"],"validation":["3"],"label_schema":list(LABELS)}))
            result=partition(p,manifest,p/"out")
            self.assertEqual(result["partitions"],{"gold_train":3,"gold_validation":1,"unlabeled_pool":2})
            self.assertFalse(result["ready_for_large_corpus_supervised_training"])
            self.assertEqual(result["gold_train_class_balance"]["ACL"],{"positive":1,"negative":2})
            with (p/"out"/"unlabeled_pool.csv").open() as f:
                rows=list(csv.DictReader(f))
            self.assertTrue(all(not row["ACL"] for row in rows))
            self.assertNotIn("secret report",(p/"out"/"dataset_summary.json").read_text())
    def test_reject_missing_series(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            with (p/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i in range(3):w.writerow({"StudyInstanceUID":str(i),"ACL":"1" if i<2 else ""})
            (p/"train_series.csv").write_text("StudyInstanceUID,SeriesInstanceUID\n0,x\n")
            m=p/"manifest.json"
            m.write_text(json.dumps({"train":["0"],"validation":["1"],"label_schema":list(LABELS)}))
            with self.assertRaisesRegex(ValueError,"series metadata"):
                partition(p,m,p/"out")
if __name__=="__main__":unittest.main()
