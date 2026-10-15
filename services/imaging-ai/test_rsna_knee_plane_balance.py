import unittest
from rsna_knee import balanced_series,series_index

class BalancedSeriesTest(unittest.TestCase):
    def test_three_planes_and_order_stability(self):
        rows=[
            {"StudyInstanceUID":"one","SeriesInstanceUID":"ZZZ","Anatomical_Plane":"Axial"},
            {"StudyInstanceUID":"one","SeriesInstanceUID":"AAA","Anatomical_Plane":"Coronal"},
            {"StudyInstanceUID":"one","SeriesInstanceUID":"MMM","Anatomical_Plane":"Sagittal"},
            {"StudyInstanceUID":"one","SeriesInstanceUID":"NNN","Anatomical_Plane":"Sagittal"},
        ]
        self.assertEqual(balanced_series(rows,3)["one"],["MMM","AAA","ZZZ"])
        self.assertEqual(balanced_series(list(reversed(rows)),3),balanced_series(rows,3))
        self.assertEqual(series_index(rows)["one"][:3],["MMM","AAA","ZZZ"])

    def test_missing_plane_and_unsafe_ids(self):
        rows=[{"StudyInstanceUID":"one","SeriesInstanceUID":"A","Anatomical_Plane":"Sagittal"},
              {"StudyInstanceUID":"one","SeriesInstanceUID":"B","Anatomical_Plane":"Unknown"}]
        self.assertEqual(balanced_series(rows,3)["one"],["A"])
        with self.assertRaises(ValueError):
            balanced_series([{"StudyInstanceUID":"../x","SeriesInstanceUID":"foo","Anatomical_Plane":"Axial"}])
        with self.assertRaises(ValueError):
            balanced_series([{"StudyInstanceUID":"one","SeriesInstanceUID":"foo\\bar","Anatomical_Plane":"Axial"}])

if __name__=="__main__":unittest.main()
