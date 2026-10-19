#!/usr/bin/env python3
"""Non-clinical contract tests. No artificial array is medical model evidence."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import nibabel as nib
import numpy as np
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, CTImageStorage, generate_uid

MODULE=Path(__file__).with_name("real-ai-cac-public-ct.py")
spec=importlib.util.spec_from_file_location("opus_ai_cac",MODULE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class CACResearchContract(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.ctdir=self.root/"DICOM"
        self.ctdir.mkdir()
        self.series=generate_uid()
        self.study=generate_uid()
        self.frame=generate_uid()
        self.paths=[]
        for i in range(16):
            fm=FileMetaDataset()
            fm.TransferSyntaxUID=ExplicitVRLittleEndian
            fm.MediaStorageSOPClassUID=CTImageStorage
            fm.MediaStorageSOPInstanceUID=generate_uid()
            ds=FileDataset(None,{},file_meta=fm,preamble=b"\0"*128)
            ds.SOPClassUID=CTImageStorage
            ds.SOPInstanceUID=fm.MediaStorageSOPInstanceUID
            ds.Modality="CT"
            ds.SeriesInstanceUID=self.series
            ds.FrameOfReferenceUID=self.frame
            ds.StudyInstanceUID=self.study
            ds.Rows=ds.Columns=512
            ds.PixelSpacing=[0.7,0.7]
            ds.SliceThickness=3.0
            ds.ImagePositionPatient=[0.,0.,i*3.]
            ds.ImageOrientationPatient=[1,0,0,0,1,0]
            ds.RescaleSlope=1
            ds.RescaleIntercept=-1024
            ds.SeriesDescription="CHEST NONCONTRAST"
            ds.StudyDescription="CHEST"
            ds.PhotometricInterpretation="MONOCHROME2"
            ds.SamplesPerPixel=1
            ds.PixelRepresentation=1
            ds.BitsAllocated=16
            ds.BitsStored=16
            ds.HighBit=15
            ds.PixelData=np.zeros((512,512),np.int16).tobytes()
            path=self.ctdir/f"slice-{i:03d}.dcm"
            ds.save_as(str(path),write_like_original=False)
            self.paths.append(path)

    def mutate(self,idx,key,value):
        ds=pydicom.dcmread(str(self.paths[idx]))
        setattr(ds,key,value)
        ds.save_as(str(self.paths[idx]),write_like_original=False)

    def test_unmodified_single_axial_series_is_admitted(self):
        selection=m.select_public_ct_slices(self.ctdir)
        self.assertEqual(selection["shape"],(512,512,16))
        self.assertEqual(selection["voxelSpacingMm"],[0.7,0.7,3.0])
        self.assertEqual(len(selection["sourceSha256"]),64)

    def test_contrast_series_rejected(self):
        self.mutate(0,"ContrastBolusAgent","iodinated")
        with self.assertRaises(ValueError):m.select_public_ct_slices(self.ctdir)

    def test_duplicate_slice_or_mixed_series_rejected(self):
        ds=pydicom.dcmread(str(self.paths[0]))
        self.mutate(1,"SOPInstanceUID",ds.SOPInstanceUID)
        with self.assertRaises(ValueError):m.select_public_ct_slices(self.ctdir)

    def test_mixed_studies_refused_even_when_series_uid_same(self):
        self.mutate(5,"StudyInstanceUID",generate_uid())
        with self.assertRaises(ValueError):m.select_public_ct_slices(self.ctdir)

    def test_irregular_slice_geometry_rejected(self):
        self.mutate(15,"ImagePositionPatient",[0,0,999])
        with self.assertRaises(ValueError):m.select_public_ct_slices(self.ctdir)

    def test_publisher_thickness_normalization_exact(self):
        image=np.zeros((4,4,3),np.float32)
        mask=np.zeros(image.shape,np.uint8)
        mask[0:2,0:2,0]=1
        image[0:2,0:2,0]=280
        # 4 voxels x 1 mm² x 3mm / 3mm x weight 2 = 8
        score,boxes=m.agatston_like(image,mask,[1.,1.,3.])
        self.assertEqual(score,8)
        self.assertEqual(len(boxes),1)
        self.assertEqual(boxes[0]["voxelBBox"],[[0,1],[0,1],[0,0]])

    def test_single_voxel_is_excluded_like_vendor_code(self):
        x=np.zeros((3,3,2),np.float32)
        y=np.zeros(x.shape,np.uint8)
        x[1,1,1]=990
        y[1,1,1]=1
        self.assertEqual(m.agatston_like(x,y,[1,1,3])[0],0)

    def test_nifti_expert_fails_on_mismatched_grid(self):
        selection=m.select_public_ct_slices(self.ctdir)
        arr=np.zeros(selection["shape"],np.uint8)
        affine=np.eye(4)
        im=nib.Nifti1Image(arr,affine)
        im.header.set_xyzt_units("mm")
        path=self.root/"expert.nii.gz"
        nib.save(im,str(path))
        with self.assertRaises(ValueError):
            m.read_expert_same_grid(path,selection["shape"],selection["affineLPS"])

    def test_nifti_expert_accepts_exact_native_physical_grid(self):
        selection=m.select_public_ct_slices(self.ctdir)
        aff=np.diag([-1.,-1.,1.,1.]) @ selection["affineLPS"]
        arr=np.zeros(selection["shape"],np.uint8)
        arr[7,9,3]=1
        im=nib.Nifti1Image(arr,aff)
        im.header.set_xyzt_units("mm")
        path=self.root/"expert.nii.gz"
        nib.save(im,str(path))
        read=m.read_expert_same_grid(path,arr.shape,selection["affineLPS"])
        self.assertEqual(int(read.sum()),1)

    def test_publisher_model_integrity_cannot_accept_missing_bytes(self):
        folder=self.root/"original-model"
        folder.mkdir()
        (folder/"publisher.json").write_text(json.dumps({
            "schema":"opus-ai-cac-official-release/v1",
            "publisher":m.MODEL_REPO,
            "publisherCodeCommit":m.MODEL_CODE_COMMIT,
            "release":m.MODEL_RELEASE,"releaseAssetUrl":m.MODEL_URL,
            "releaseAssetBytes":m.MODEL_BYTES,"publicResearchOnly":True,
            "checkpointSha256Observed":"0"*64}))
        with self.assertRaises(ValueError):m.verify_weights(folder)

if __name__=="__main__":
    unittest.main()
