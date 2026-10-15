import csv
import json
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee import LABELS
from rsna_knee_validation import load_partition,make_manifest

class SharedSplitTests(unittest.TestCase):
    def test_shared_split_and_unexpected_uid(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/"gold.csv";manifest=root/"split.json"
            with source.open("w",newline="") as f:
                w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
                for i in range(20):w.writerow({"StudyInstanceUID":f"study-{i}","ACL":str(i%2)})
            data=make_manifest(source,manifest)
            with source.open(newline="") as f:rows=list(csv.DictReader(f))
            train,val=load_partition(rows,manifest)
            self.assertEqual({r["StudyInstanceUID"] for r in train},set(data["train"]))
            self.assertEqual({r["StudyInstanceUID"] for r in val},set(data["validation"]))
            with self.assertRaisesRegex(ValueError,"exactly"):
                load_partition(rows[:-1],manifest)
            data["validation"].append(data["train"][0])
            manifest.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError,"overlapping"):
                load_partition(rows,manifest)

    def test_both_runners_require_manifest(self):
        import ast
        for file in ("rsna_knee_dinov2.py","rsna_knee_coatnet.py"):
            source=Path(__file__).with_name(file).read_text()
            self.assertIn('p.add_argument("--manifest",required=True',source)
            self.assertIn("load_partition(rows,args.manifest)",source)
            ast.parse(source)
        dino=Path(__file__).with_name("rsna_knee_dinov2.py").read_text()
        self.assertIn('output.with_suffix(".validation.csv")',dino)

if __name__=="__main__":unittest.main()
