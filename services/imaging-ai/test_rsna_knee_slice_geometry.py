"""Geometry ordering must be deterministic, opt-in, and checkpoint-safe."""
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace
from rsna_knee import ordered_mri_files


class SliceGeometryTests(unittest.TestCase):
    def setUp(self):
        self.files=[Path(f"slice_{v}.dcm") for v in (1,2,3)]

    def dicom(self, path, stop_before_pixels=True):
        number=int(path.stem.split("_")[-1])
        # File-name order and spatial order deliberately disagree.
        z={1:30,2:10,3:20}[number]
        return SimpleNamespace(
            ImageOrientationPatient=[1,0,0,0,1,0],
            ImagePositionPatient=[0,0,z],
            InstanceNumber=number,
        )

    def test_geometry_beats_filename_and_instance(self):
        with patch("pydicom.dcmread",side_effect=self.dicom):
            self.assertEqual([p.stem for p in ordered_mri_files(self.files,"geometry-v2")],
                             ["slice_2","slice_3","slice_1"])

    def test_legacy_never_opens_headers(self):
        with patch("pydicom.dcmread",side_effect=AssertionError("read")):
            self.assertEqual(ordered_mri_files(self.files),sorted(self.files))

    def test_incomplete_geometry_uses_instance_number(self):
        def missing(path,stop_before_pixels=True):
            v=int(path.stem.split("_")[-1])
            return SimpleNamespace(InstanceNumber=4-v)
        with patch("pydicom.dcmread",side_effect=missing):
            self.assertEqual([p.stem for p in ordered_mri_files(self.files,"geometry-v2")],
                             ["slice_3","slice_2","slice_1"])

    def test_duplicate_positions_fall_back(self):
        def duplicate(path,stop_before_pixels=True):
            v=int(path.stem.split("_")[-1])
            return SimpleNamespace(
                ImageOrientationPatient=[1,0,0,0,1,0],
                ImagePositionPatient=[0,0,10],
                InstanceNumber=4-v)
        with patch("pydicom.dcmread",side_effect=duplicate):
            self.assertEqual([p.stem for p in ordered_mri_files(self.files,"geometry-v2")],
                             ["slice_3","slice_2","slice_1"])

    def test_unsupported_mode(self):
        with self.assertRaises(ValueError):
            ordered_mri_files(self.files,"unknown")


if __name__=="__main__":
    unittest.main()
