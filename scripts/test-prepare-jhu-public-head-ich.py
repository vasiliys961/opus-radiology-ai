#!/usr/bin/env python3
"""No-patient pure contracts for JHU public NCCT acquisition and strict evidence."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
def load(name,modname):
    spec=importlib.util.spec_from_file_location(modname,ROOT/name)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

m=load("prepare-jhu-public-head-ich.py","jhu_public_ich")
runner=load("run-ianpan-ich-research.py","ianpan_public_ct_runner")

class JHUPublicSourceTest(unittest.TestCase):
    def make_original(self,root):
        import numpy as np
        import nibabel as nib
        data=np.zeros((32,32,12),np.float32)
        data[:,:,:]=-970
        data[4:28,4:28,:]=40
        data[10:20,10:20,6]=220
        nii=root/"original.nii.gz"
        nif=nib.Nifti1Image(data,np.diag([.8,.8,2.,1.]))
        nif.set_sform(np.diag([.8,.8,2.,1.]),code=1)
        nib.save(nif,nii)
        return nii

    def test_exact_published_member_and_sha_verified_nifti(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);original=self.make_original(root)
            tarname=root/"public.tar.xz"
            with tarfile.open(tarname,"w:xz") as tar:
                tar.add(original,arcname=m.SOURCE_MEMBER)
            saved=m.ARCHIVE_MD5
            try:
                m.ARCHIVE_MD5=hashlib.md5(tarname.read_bytes(),usedforsecurity=False).hexdigest()
                member=root/"source.nii.gz"
                assert m.original_nifti_from_archive(tarname,member)==m.sha256(member)
                output=root/"head.nii"
                manifest=root/"manifest.json"
                document=m.convert_publisher_ct_and_manifest(member,output,manifest)
                self.assertEqual(document["sourceUnits"],
                    "PUBLISHED_DICOM_DERIVED_CT_HU_LIKE_NOT_DICOM_RESCALE_INDEPENDENTLY_VERIFIED")
                self.assertEqual(document["publisherProvenance"]["dicomRescaleIndependentlyVerified"],False)
                self.assertEqual(document["sourceNiftiSha256"],runner.sha256(output))
                self.assertIs(runner.validate_public_manifest(output,manifest)["sourceFullStudy"],True)
                self.assertEqual(document["publisherProvenance"]["dimensionsXYZ"],[32,32,12])
                self.assertFalse(document["publisherProvenance"]["publicSourceAuditIsNotClinicalValidation"] is False)
                # No test image is presented as a real clinical finding.
                self.assertNotIn("clinicalFindingConfirmed",manifest.read_text())
                data=json.loads(manifest.read_text())
                data["publisherProvenance"]["datasetDoi"]="invented_doi"
                manifest.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    runner.validate_public_manifest(output,manifest)
            finally:
                m.ARCHIVE_MD5=saved

    def test_windowed_or_normalized_source_refused(self):
        import nibabel as nib
        import numpy as np
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            scan=nib.Nifti1Image(np.ones((32,32,12),np.float32)*80,np.eye(4))
            path=root/"windowed.nii.gz";nib.save(scan,path)
            with self.assertRaisesRegex(ValueError,"HU"):
                m.convert_publisher_ct_and_manifest(path,root/"bad.nii",root/"bad.json")
            self.assertFalse((root/"bad.nii").exists())

    def test_rejects_wrong_member_and_modified_archive(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);original=self.make_original(root)
            tarname=root/"archive.tar.xz"
            with tarfile.open(tarname,"w:xz") as tar:
                tar.add(original,arcname="other/unreviewed.nii.gz")
            saved=m.ARCHIVE_MD5
            try:
                m.ARCHIVE_MD5=hashlib.md5(tarname.read_bytes(),usedforsecurity=False).hexdigest()
                with self.assertRaisesRegex(ValueError,"not_found"):
                    m.original_nifti_from_archive(tarname,root/"never.nii.gz")
                tarname.write_bytes(tarname.read_bytes()+b"x")
                with self.assertRaisesRegex(ValueError,"digest_changed"):
                    m.original_nifti_from_archive(tarname,root/"never.nii.gz")
            finally:
                m.ARCHIVE_MD5=saved

if __name__=="__main__":
    unittest.main()
