"""End-to-end DICOM pixels -> correctly ordered HU NIfTI -> MONAI source checks."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("chest_converter",HERE/"chest_dicom_to_monai.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TestChestDicomToMonai(unittest.TestCase):
    def make_study(self,root,*,gap=False,mixed=False):
        from pydicom.dataset import Dataset,FileDataset,FileMetaDataset
        from pydicom.uid import ExplicitVRLittleEndian,CTImageStorage,generate_uid
        root.mkdir()
        study,series,frame=generate_uid(),generate_uid(),generate_uid()
        for i in range(8):
            meta=FileMetaDataset()
            meta.TransferSyntaxUID=ExplicitVRLittleEndian
            meta.MediaStorageSOPClassUID=CTImageStorage
            meta.MediaStorageSOPInstanceUID=generate_uid()
            ds=FileDataset(str(root/f"{i}.dcm"),{},file_meta=meta,preamble=b"\x00"*128)
            ds.is_little_endian=True;ds.is_implicit_VR=False
            ds.SOPClassUID=CTImageStorage
            ds.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
            ds.Modality="CT";ds.StudyInstanceUID=study
            ds.SeriesInstanceUID=generate_uid() if mixed and i==7 else series
            ds.FrameOfReferenceUID=frame
            ds.Rows=8;ds.Columns=10;ds.SamplesPerPixel=1
            ds.PhotometricInterpretation="MONOCHROME2"
            ds.PixelRepresentation=1;ds.BitsAllocated=16;ds.BitsStored=16;ds.HighBit=15
            ds.ImageOrientationPatient=[1,0,0,0,1,0]
            ds.ImagePositionPatient=[0,0,float(i*2+(2 if gap and i==7 else 0))]
            ds.PixelSpacing=[0.7,0.8]
            ds.RescaleSlope=2;ds.RescaleIntercept=-1024;ds.RescaleType="HU"
            ds.PixelData=(np.arange(80,dtype="<i2").reshape(8,10)+i*100).tobytes()
            ds.save_as(str(root/f"{i}.dcm"),write_like_original=False)
    def test_hu_voxel_affine_and_explicit_admission(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.make_study(root/"source")
            dest=root/"volume.nii"
            info=mod.convert_dicom_chest(root/"source",dest,
                public_rights=True,deidentified=True)
            self.assertTrue(info["admissionCreated"])
            self.assertEqual(info["dimensions"],(10,8,8))
            arr=np.memmap(dest,dtype="<f4",offset=352,mode="r",shape=(10,8,8),order="F")
            self.assertEqual(arr[3,4,5],float((4*10+3+500)*2-1024))
            self.assertTrue((root/"volume.admission.json").is_file())
            import sys
            sys.path.insert(0,str(HERE))
            import monai_bound_nodule as runner
            source=runner.original_nifti(dest)
            runner.source_admission(root/"volume.admission.json",source)
            self.assertEqual(source["dimensions"],[10,8,8])
            self.assertAlmostEqual(source["affineLps"][0],0.8,places=5)
            self.assertAlmostEqual(source["affineLps"][5],0.7,places=5)
            self.assertAlmostEqual(source["affineLps"][10],2.0,places=5)
    def test_refuses_gap_and_mixed_series(self):
        for flag in ("gap","mixed"):
            with self.subTest(flag=flag),tempfile.TemporaryDirectory() as t:
                root=Path(t);self.make_study(root/"source",**{flag:True})
                with self.assertRaises(ValueError):
                    mod.convert_dicom_chest(root/"source",root/"out.nii")
                self.assertFalse((root/"out.nii").exists())
    def test_no_automatic_public_attestation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.make_study(root/"source")
            info=mod.convert_dicom_chest(root/"source",root/"out.nii")
            self.assertFalse(info["admissionCreated"])
            self.assertFalse((root/"out.admission.json").exists())

if __name__=="__main__":unittest.main()
