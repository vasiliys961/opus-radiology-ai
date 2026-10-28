#!/usr/bin/env python3
"""Synthetic geometry regression for native MRI DICOM conversion; no medical evidence."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("converter",HERE/"brain_flair_dicom_to_nifti.py")
converter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)

def fixture(folder, *, gap=False):
    from pydicom.dataset import Dataset,FileDataset
    from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid
    study,series,frame=[generate_uid() for _ in range(3)]
    for index in range(8):
        meta=Dataset()
        meta.MediaStorageSOPClassUID=MRImageStorage
        meta.MediaStorageSOPInstanceUID=generate_uid()
        meta.TransferSyntaxUID=ExplicitVRLittleEndian
        ds=FileDataset(str(folder/f"{index}.dcm"),{},file_meta=meta,preamble=b"\0"*128)
        ds.is_little_endian=True;ds.is_implicit_VR=False
        ds.Modality="MR";ds.SOPClassUID=MRImageStorage
        ds.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID=study;ds.SeriesInstanceUID=series
        ds.FrameOfReferenceUID=frame
        ds.ImageOrientationPatient=[1,0,0,0,1,0]
        ds.ImagePositionPatient=[10,20,(index+1 if gap and index>=4 else index)*2]
        ds.PixelSpacing=[.8,.7]
        ds.Rows=16;ds.Columns=12
        ds.SamplesPerPixel=1;ds.PhotometricInterpretation="MONOCHROME2"
        ds.BitsAllocated=16;ds.BitsStored=16;ds.HighBit=15
        ds.PixelRepresentation=0
        ds.PixelData=np.full((16,12),index+100,dtype="<u2").tobytes()
        ds.save_as(folder/f"{index}.dcm",write_like_original=False)

class TestFlair(unittest.TestCase):
    def test_native_grid_and_intensity(self):
        import nibabel as nib
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder=root/"dicom";folder.mkdir();fixture(folder)
            dest=root/"flair.nii.gz"
            result=converter.convert_flair(folder,dest,protocol_confirmed=True)
            img=nib.load(str(dest))
            self.assertEqual(img.shape,(12,16,8))
            np.testing.assert_allclose(np.asarray(img.dataobj)[3,5,:],np.arange(8)+100)
            np.testing.assert_allclose(img.affine[:3,3],[-10,-20,0])
            np.testing.assert_allclose(img.affine[:3,2],[0,0,2])
            self.assertEqual(len(result["sourceSOPInstanceUIDs"]),8)
            self.assertFalse(result["modelInferenceCompleted"])
    def test_reject_gapped_series(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder=root/"dicom";folder.mkdir();fixture(folder,gap=True)
            with self.assertRaisesRegex(ValueError,"gapped"):
                converter.convert_flair(folder,root/"flair.nii.gz",protocol_confirmed=True)
    def test_do_not_infer_flair_from_metadata(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,"FLAIR_protocol"):
                converter.convert_flair(Path(d),Path(d)/"flair.nii.gz",protocol_confirmed=False)

if __name__=="__main__":unittest.main()
