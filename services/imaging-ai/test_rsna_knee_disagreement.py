import csv
import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee import LABELS
from rsna_knee_disagreement import disagreement_rows,write_report

class DisagreementAuditTest(unittest.TestCase):
    def test_gap_counts_and_label_alignment(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for name,values in (("d",[.2]*12),("c",[.7]*12)):
                with (root/(name+".csv")).open("w",newline="") as f:
                    w=csv.writer(f);w.writerow(["StudyInstanceUID",*LABELS])
                    w.writerow(["study1",*values])
            report=write_report(root/"d.csv",root/"c.csv",root/"audit.csv",.3)
            self.assertEqual(report["total_flagged_pairs"],12)
            self.assertAlmostEqual(report["by_label"]["ACL"]["mean_abs_gap"],.5)
            self.assertTrue((root/"audit.summary.json").exists())
            with self.assertRaises(ValueError):
                disagreement_rows(root/"d.csv",root/"c.csv",1.2)
if __name__=="__main__":unittest.main()
