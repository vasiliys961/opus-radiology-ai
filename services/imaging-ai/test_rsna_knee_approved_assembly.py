import csv,json,tempfile,unittest
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_approved_assembly import assemble
class AssemblyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name)
        with (self.p/"train.csv").open("w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
            for i in range(5):w.writerow({"StudyInstanceUID":str(i),"ACL":str(i%2) if i<3 else ""})
        (self.p/"manifest.json").write_text(json.dumps({"train":["0","1"],"validation":["2"],"label_schema":list(LABELS)}))
    def tearDown(self):self.tmp.cleanup()
    def approved(self,ids):
        f=self.p/"approved.csv"
        with f.open("w",newline="") as out:
            w=csv.DictWriter(out,fieldnames=["StudyInstanceUID",*LABELS]);w.writeheader()
            for i in ids:w.writerow({"StudyInstanceUID":str(i),"Effusion":"1"})
        return f
    def test_disjoint_and_unknown_blank(self):
        out=self.p/"output.csv"
        result=assemble(self.p,self.p/"manifest.json",self.approved([3,4]),out)
        self.assertEqual(result["training_studies"],4)
        self.assertEqual(result["approved_weak_studies"],2)
        with out.open() as f:rows=list(csv.DictReader(f))
        self.assertEqual({x["StudyInstanceUID"] for x in rows},{"0","1","3","4"})
        self.assertEqual(next(x for x in rows if x["StudyInstanceUID"]=="3")["ACL"],"")
    def test_reject_gold_val_leak(self):
        with self.assertRaisesRegex(ValueError,"gold"):
            assemble(self.p,self.p/"manifest.json",self.approved([2]),self.p/"out.csv")
    def test_refuse_inferred_negative(self):
        f=self.approved([3])
        content=f.read_text().replace(",1\n",",unknown\n")
        f.write_text(content)
        with self.assertRaises(ValueError):assemble(self.p,self.p/"manifest.json",f,self.p/"out.csv")
if __name__=="__main__":unittest.main()
