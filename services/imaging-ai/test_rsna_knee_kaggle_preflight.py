import csv
import tempfile
import unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_kaggle_preflight import inspect

class KagglePreflightTests(unittest.TestCase):
    def test_counts_and_requires_validated_labels(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/"train_series").mkdir()
            with (root/"train.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                w.writerow({"StudyInstanceUID":"a","ACL":1})
                w.writerow({"StudyInstanceUID":"b"})
            with (root/"train_series.csv").open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID","SeriesInstanceUID"]);w.writeheader()
                w.writerow({"StudyInstanceUID":"a","SeriesInstanceUID":"s"})
            result=inspect(root)
            self.assertEqual(result["train_studies"],2)
            self.assertEqual(result["gold_labeled_studies"],1)
            self.assertEqual(result["studies_without_series_metadata"],1)
            with self.assertRaises(ValueError):
                inspect(root,label_csv=root/"train.csv")
    def test_rejects_missing_dataset(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(FileNotFoundError):inspect(d)

if __name__=="__main__":unittest.main()
