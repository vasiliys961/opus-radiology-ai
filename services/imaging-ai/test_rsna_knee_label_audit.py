import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee import LABELS
from rsna_knee_label_audit import audit

class CoverageAuditTests(unittest.TestCase):
    def test_unknown_is_not_negative(self):
        data=audit([
            {"StudyInstanceUID":"x","ACL":"1","MCL":"0"},
            {"StudyInstanceUID":"y"},
            {"StudyInstanceUID":"z",**{label:"0" for label in LABELS}}
        ])
        self.assertEqual(data["complete_gold"],1)
        self.assertEqual(data["partial"],1)
        self.assertEqual(data["unlabeled"],1)
        self.assertEqual(data["labels"]["ACL"],{"positive":1,"negative":1,"unknown":1})
        self.assertEqual(data["labels"]["MCL"],{"positive":0,"negative":2,"unknown":1})

    def test_repeated_id_rejected(self):
        with self.assertRaisesRegex(ValueError,"repeated"):
            audit([{"StudyInstanceUID":"x"},{"StudyInstanceUID":"x"}])
if __name__=="__main__":unittest.main()
