import argparse
import csv
import json
import tempfile
import unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_kaggle_train import prepare

class LauncherTests(unittest.TestCase):
    def fixtures(self,root,weak=False):
        (root/"train_series").mkdir()
        originals=[]
        labels=[]
        for i in range(5):
            uid=f"case-{i}"
            row={"StudyInstanceUID":uid,**{label:"" for label in LABELS}}
            if i<3:row["ACL"]=str(i%2)
            originals.append(row)
            new=dict(row)
            if i>=3 and weak:new["ACL"]=str(i%2)
            labels.append(new)
        for name,values in (("train.csv",originals),("labels.csv",labels)):
            with (root/name).open("w",newline="") as f:
                writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
                writer.writeheader();writer.writerows(values)
        with (root/"train_series.csv").open("w",newline="") as f:
            writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID","SeriesInstanceUID"])
            writer.writeheader()
            for i in range(5):writer.writerow({"StudyInstanceUID":f"case-{i}","SeriesInstanceUID":"series"})
        (root/"split.json").write_text(json.dumps({
            "label_schema":list(LABELS),
            "train":["case-0","case-1","case-3","case-4"],
            "validation":["case-2"]}))
    def options(self,root):
        return argparse.Namespace(competition_root=str(root),labels=str(root/"labels.csv"),
            manifest=str(root/"split.json"),output=str(root/"out.pt"),cache_dir=None,
            resume=None,epochs=2,slices=8,series_limit=3,slice_batch=8,min_weak_studies=2)
    def test_rejects_without_mass_weak_supervision(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixtures(root)
            with self.assertRaisesRegex(ValueError,"Only 0 weak-labeled"):
                prepare(self.options(root))
    def test_accepts_approved_training_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixtures(root,weak=True)
            # Validation requires at least two studies: fail closed rather than run.
            with self.assertRaisesRegex(ValueError,"validation too small"):
                prepare(self.options(root))
    def test_validation_gate_checks_before_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.fixtures(root,weak=True)
            split=root/"split.json"
            data=json.loads(split.read_text())
            data["train"].remove("case-1");data["validation"].append("case-1")
            split.write_text(json.dumps(data))
            command,summary=prepare(self.options(root))
            self.assertEqual(summary["weak_training_studies"],2)
            self.assertEqual(summary["gold_validation"],2)
            self.assertIn("--head",command)
            self.assertIn("finding-v2",command)
            self.assertTrue(command[0])
if __name__=="__main__":unittest.main()
