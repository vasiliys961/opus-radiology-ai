import tempfile
import unittest
from pathlib import Path
import pydicom
from pydicom.dataset import FileDataset,FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, SecondaryCaptureImageStorage,generate_uid
from rsna_knee_dicom_audit import inspect_series

class DicomAuditTest(unittest.TestCase):
    def test_missing_series_and_partial_plane(self):
        with tempfile.TemporaryDirectory() as directory:
            rows=[{"StudyInstanceUID":"study1","SeriesInstanceUID":"series1","Anatomical_Plane":"Sagittal"}]
            result=inspect_series(directory,rows)
            self.assertEqual(result["findings"]["series_no_dicom_files"],1)
            self.assertEqual(result["studies_three_planes"],0)
            self.assertEqual(result["series_total"],1)
    def test_duplicate_instance_number(self):
        with tempfile.TemporaryDirectory() as directory:
            folder=Path(directory)/"study1"/"series1"
            folder.mkdir(parents=True)
            for i in range(3):
                meta=FileMetaDataset()
                meta.TransferSyntaxUID=ExplicitVRLittleEndian
                meta.MediaStorageSOPClassUID=SecondaryCaptureImageStorage
                meta.MediaStorageSOPInstanceUID=generate_uid()
                ds=FileDataset(str(folder/f"{i}.dcm"),{},file_meta=meta,preamble=b"\\0"*128)
                ds.Rows=32;ds.Columns=32;ds.InstanceNumber=1
                ds.save_as(str(folder/f"{i}.dcm"),enforce_file_format=True)
            result=inspect_series(directory,[{"StudyInstanceUID":"study1","SeriesInstanceUID":"series1","Anatomical_Plane":"Sagittal"}])
            self.assertEqual(result["findings"]["series_repeated_instance_number"],1)
            self.assertEqual(result["dicom_files_total"],3)
    def test_reject_traversal(self):
        with self.assertRaises(ValueError):
            inspect_series("/tmp",[{"StudyInstanceUID":"..","SeriesInstanceUID":"1"}])
if __name__=="__main__":unittest.main()
