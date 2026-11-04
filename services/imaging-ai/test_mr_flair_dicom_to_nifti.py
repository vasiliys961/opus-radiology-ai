"""Real decoded MR DICOM signal to native NIfTI geometry regression."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("chest_converter",HERE/"mr_flair_dicom_to_nifti.py")
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TestMrFlairDicom(unittest.TestCase):
    def make_study(self,root,*,gap=False,mixed=False):
        from pydicom.dataset import Dataset,FileDataset,FileMetaDataset
        from pydicom.uid import ExplicitVRLittleEndian,MRImageStorage,generate_uid
        root.mkdir()
        study,series,frame=generate_uid(),generate_uid(),generate_uid()
        for i in range(8):
            meta=FileMetaDataset()
            meta.TransferSyntaxUID=ExplicitVRLittleEndian
            meta.MediaStorageSOPClassUID=MRImageStorage
            meta.MediaStorageSOPInstanceUID=generate_uid()
            ds=FileDataset(str(root/f"{i}.dcm"),{},file_meta=meta,preamble=b"\x00"*128)
            ds.is_little_endian=True;ds.is_implicit_VR=False
            ds.SOPClassUID=MRImageStorage
            ds.SOPInstanceUID=meta.MediaStorageSOPInstanceUID
            ds.Modality="MR";ds.StudyInstanceUID=study
            ds.SeriesInstanceUID=generate_uid() if mixed and i==7 else series
            ds.FrameOfReferenceUID=frame
            ds.Rows=8;ds.Columns=10;ds.SamplesPerPixel=1
            ds.PhotometricInterpretation="MONOCHROME2"
            ds.PixelRepresentation=1;ds.BitsAllocated=16;ds.BitsStored=16;ds.HighBit=15
            ds.ImageOrientationPatient=[1,0,0,0,1,0]
            ds.ImagePositionPatient=[0,0,float(i*2+(2 if gap and i==7 else 0))]
            ds.PixelSpacing=[0.7,0.8]
            ds.RescaleSlope=2;ds.RescaleIntercept=3
            ds.PixelData=(np.arange(80,dtype="<i2").reshape(8,10)+i*100).tobytes()
            ds.save_as(str(root/f"{i}.dcm"),write_like_original=False)
    def test_native_signal_order_and_geometry(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.make_study(root/"source")
            dest=root/"volume.nii"
            info=mod.convert_mr_flair(root/"source",dest)
            self.assertEqual(info["dimensions"],(10,8,8))
            arr=np.memmap(dest,dtype="<f4",offset=352,mode="r",shape=(10,8,8),order="F")
            self.assertEqual(arr[3,4,5],float((4*10+3+500)*2+3))
            import sys
            sys.path.insert(0,str(HERE))
            import monai_bound_nodule as runner
            source=runner.original_nifti(dest)
            self.assertEqual(source["dimensions"],[10,8,8])
            self.assertAlmostEqual(source["affineLps"][0],0.8,places=5)
            self.assertAlmostEqual(source["affineLps"][5],0.7,places=5)
            self.assertAlmostEqual(source["affineLps"][10],2.0,places=5)
    def test_refuses_gap_and_mixed_series(self):
        for flag in ("gap","mixed"):
            with self.subTest(flag=flag),tempfile.TemporaryDirectory() as t:
                root=Path(t);self.make_study(root/"source",**{flag:True})
                with self.assertRaises(ValueError):
                    mod.convert_mr_flair(root/"source",root/"out.nii")
                self.assertFalse((root/"out.nii").exists())
    def test_does_not_claim_flair_sequence_or_deidentification(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);self.make_study(root/"source")
            info=mod.convert_mr_flair(root/"source",root/"out.nii")
            self.assertFalse(info["sequenceCertifiedByOperator"])
            self.assertFalse((root/"out.admission.json").exists())

if __name__=="__main__":unittest.main()
