import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("knee",Path(__file__).with_name("rsna_knee.py"))
knee=importlib.util.module_from_spec(spec)
spec.loader.exec_module(knee)
class KneeContract(unittest.TestCase):
    def test_labels(self):
        y,m=knee.extract_labels({"ACL":"1","MCL":"","Fracture":"0"})
        self.assertEqual(len(y),12)
        self.assertEqual(m[0],1)
        self.assertEqual(m[1],0)
        self.assertEqual(m[-1],1)
    def test_path_rejection(self):
        with self.assertRaises(ValueError):
            knee.series_index([{"StudyInstanceUID":"../bad","SeriesInstanceUID":"x","Anatomical_Plane":"Axial"}])
    def test_label_order(self):
        self.assertEqual(knee.LABELS[-1],"Fracture")
if __name__=="__main__":unittest.main()
