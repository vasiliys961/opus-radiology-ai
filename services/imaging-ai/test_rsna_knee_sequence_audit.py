import unittest
from rsna_knee_sequence_audit import sequence_type,audit_series

class SequenceAuditTest(unittest.TestCase):
    def test_conservative_identification(self):
        examples={"Sag PD FATSAT":"PD_FS","T2 TSE":"T2",
                  "Cor STIR":"STIR","T1 FS":"T1_FS",
                  "unknown routine":"unknown","PD":"PD"}
        for name,expected in examples.items():
            self.assertEqual(sequence_type({"SeriesDescription":name}),expected)
        self.assertEqual(sequence_type({"SeriesInstanceUID":"PD T2 FS"}),"unknown")

    def test_stats(self):
        rows=[{"StudyInstanceUID":"u","SeriesInstanceUID":str(i),
               "Anatomical_Plane":plane,"SeriesDescription":description}
              for i,(plane,description) in enumerate([
                  ("Sagittal","PD FS"),("Coronal","T1"),("Axial","unknown")])]
        result=audit_series(rows)
        self.assertEqual(result["n_studies"],1)
        self.assertEqual(result["studies_with_three_planes"],1)
        self.assertAlmostEqual(result["known_sequence_fraction"],2/3)

if __name__=="__main__":unittest.main()
