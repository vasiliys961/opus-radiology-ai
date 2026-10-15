#!/usr/bin/env python3
"""Nonpatient DICOM fixtures; no CT downloads, real patients or model weights."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT=Path(__file__).with_name("prepare-ich-public-dicom-hu.py")
spec=importlib.util.spec_from_file_location("opus_public_hu_dicom",SCRIPT)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class PublicDicomHU(unittest.TestCase):
    def setUp(self):
        import numpy as np
        from pydicom.dataset import FileDataset,FileMetaDataset
        from pydicom.uid import ExplicitVRLittleEndian,CTImageStorage,generate_uid
        self.temp=tempfile.TemporaryDirectory()
        self.root=Path(self.temp.name)
        self.src=self.root/"dicom"
        self.src.mkdir()
        self.manifest=self.root/"authorization.json"
        self.study=generate_uid()
        self.series=generate_uid()
        self.base=np.arange(128*128,dtype=np.int16).reshape(128,128)%1024
        self.paths=[]
        for i in range(8):
            meta=FileMetaDataset()
            meta.TransferSyntaxUID=ExplicitVRLittleEndian
            meta.MediaStorageSOPClassUID=CTImageStorage
            sop=generate_uid()
            meta.MediaStorageSOPInstanceUID=sop
            ds=FileDataset(str(self.src/(f"slice_{i:02d}.dcm")),{},file_meta=meta,preamble=b"\0"*128)
            ds.SOPClassUID=CTImageStorage
            ds.SOPInstanceUID=sop
            ds.Modality="CT"
            ds.StudyInstanceUID=self.study
            ds.SeriesInstanceUID=self.series
            ds.ImageType=["ORIGINAL","PRIMARY","AXIAL"]
            ds.SamplesPerPixel=1
            ds.PhotometricInterpretation="MONOCHROME2"
            ds.Rows=128
            ds.Columns=128
            ds.BitsAllocated=16
            ds.BitsStored=16
            ds.HighBit=15
            ds.PixelRepresentation=1
            ds.PixelSpacing=[0.8,0.8]
            ds.ImageOrientationPatient=[1,0,0,0,1,0]
            ds.ImagePositionPatient=[-100,-100,-80+2*i]
            ds.RescaleSlope=1
            ds.RescaleIntercept=-1024
            ds.PixelData=(self.base+i*20).tobytes()
            ds.save_as(ds.filename,enforce_file_format=True)
            self.paths.append(Path(ds.filename))
        self.auth={
            "schema":"opus-public-dicom-head-ncct-authorization/v1",
            "publicDataRightsReviewed":True,
            "deidentifiedPublicDataset":True,
            "modality":"CT","anatomy":"HEAD","contrast":"NONCONTRAST",
            "sourceFullStudy":True,
            "consent":"PUBLIC-HEAD-NCCT-RESEARCH-OK",
            "dicomFiles":[{"name":p.name,"sha256":mod.file_sha(p)} for p in self.paths],
        }
        self.write_auth()

    def tearDown(self):
        self.temp.cleanup()

    def write_auth(self):
        self.manifest.write_text(json.dumps(self.auth))

    def test_hu_nifti_preserves_native_geometry_and_source_provenance(self):
        import numpy as np
        import nibabel as nib
        out=self.root/"converted.nii"
        info=self.root/"converted.json"
        r=mod.convert(self.src,self.manifest,out,info)
        image=nib.load(str(out))
        self.assertEqual(image.shape,(128,128,8))
        self.assertAlmostEqual(float(image.get_fdata()[10,20,3]),
                               float(self.base[20,10]+60-1024),places=2)
        np.testing.assert_allclose(image.affine @ np.array([10,20,3,1]),
                                   [92,84,-74,1],atol=1e-3)
        self.assertEqual(r["sourceNiftiSha256"],mod.file_sha(out))
        self.assertEqual(r["sourceUnits"],"HU_FROM_VERIFIED_DICOM_RESCALE")
        self.assertEqual(r["conversionEvidence"]["sliceCount"],8)
        self.assertFalse(r["conversionEvidence"]["independentPrivacyAuditCompleted"])
        self.assertFalse(r["conversionEvidence"]["clinicallyValidated"])
        self.assertNotIn("PatientName",info.read_text())
        with self.assertRaisesRegex(ValueError,"new_nii"):
            mod.convert(self.src,self.manifest,out,info)

    def test_tampered_original_dicom_rejected_before_conversion(self):
        self.paths[0].write_bytes(self.paths[0].read_bytes()+b"bad")
        with self.assertRaisesRegex(ValueError,"sha_mismatch"):
            mod.convert(self.src,self.manifest,self.root/"out.nii",self.root/"out.json")
        self.assertFalse((self.root/"out.nii").exists())

    def test_unreviewed_file_or_false_rights_refused(self):
        self.auth["publicDataRightsReviewed"]=False
        self.write_auth()
        with self.assertRaisesRegex(ValueError,"rights"):
            mod.authorize_series(self.src,self.manifest)
        self.auth["publicDataRightsReviewed"]=True
        self.write_auth()
        (self.src/"unreviewed.dcm").write_bytes(b"x")
        with self.assertRaisesRegex(ValueError,"unreviewed"):
            mod.authorize_series(self.src,self.manifest)

    def test_geometry_and_rescale_missing_refused(self):
        import pydicom
        ds=pydicom.dcmread(str(self.paths[4]))
        del ds.RescaleSlope
        ds.save_as(self.paths[4],enforce_file_format=True)
        self.auth["dicomFiles"][4]["sha256"]=mod.file_sha(self.paths[4])
        self.write_auth()
        paths,_=mod.authorize_series(self.src,self.manifest)
        with self.assertRaisesRegex(ValueError,"rescale"):
            mod.read_and_verify_dicom(paths)
        ds.RescaleSlope=1
        ds.ImagePositionPatient=[-100,-100,-77.3]
        ds.save_as(self.paths[4],enforce_file_format=True)
        self.auth["dicomFiles"][4]["sha256"]=mod.file_sha(self.paths[4])
        self.write_auth()
        paths,_=mod.authorize_series(self.src,self.manifest)
        with self.assertRaisesRegex(ValueError,"positions"):
            mod.read_and_verify_dicom(paths)

if __name__=="__main__":
    unittest.main()
