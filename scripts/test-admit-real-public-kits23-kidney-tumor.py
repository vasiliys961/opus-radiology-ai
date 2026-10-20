"""Offline KiTS23 ontology/source geometry contracts, not true model inference."""
import importlib.util
import tempfile
from pathlib import Path
import unittest

import nibabel as nib
import numpy as np
spec=importlib.util.spec_from_file_location("kits",Path(__file__).with_name("admit-real-public-kits23-kidney-tumor.py"))
kits=importlib.util.module_from_spec(spec)
spec.loader.exec_module(kits)


class OriginalTumorGeometry(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.p=Path(self.t.name)
        self.ct=self.p/"ct.nii.gz"
        self.ref=self.p/"expert.nii.gz"
        self.affine=np.diag([1.4,1.3,2.1,1.])
        self.img=np.full((32,32,32),-900,dtype="int16")
        self.img[5:28,5:28,5:28]=150
        self.mask=np.zeros((32,32,32),dtype="uint8")
        self.mask[6:25,6:25,6:25]=1
        self.mask[9:12,13:17,14:18]=2
        self.mask[20:22,13:16,20:23]=3
        self.save(self.ct,self.img)
        self.save(self.ref,self.mask)
    def tearDown(self):
        self.t.cleanup()
    def save(self,p,arr,affine=None):
        x=nib.Nifti1Image(arr, self.affine if affine is None else affine)
        x.header.set_xyzt_units("mm")
        nib.save(x,str(p))
    def test_real_expert_label_two_not_cyst_or_kidney(self):
        x=kits.audit_pair(self.ct,self.ref)
        self.assertTrue(x["expertTumorPositive"])
        self.assertEqual(x["originalAuthorKiTS23TumorClassId"],2)
        self.assertEqual(x["expertTumorVoxelCount"],3*4*4)
        self.assertEqual(x["observedExpertClassVoxels"]["3"],2*3*3)
        self.assertEqual(x["expertTumorNativeVoxelBoundsInclusive"],[[9,13,14],[11,16,17]])
        self.assertFalse(x["originalCancerModelForwardCompleted"])
        self.assertFalse(x["independentClinicalValidation"])
    def test_no_false_tumor_with_only_kidney_and_cyst(self):
        self.mask[self.mask==2]=0
        self.save(self.ref,self.mask)
        with self.assertRaisesRegex(ValueError,"NO POSITIVE"):
            kits.audit_pair(self.ct,self.ref)
    def test_reject_wrong_physical_geometry(self):
        affine=self.affine.copy()
        affine[0,3]=4.0
        self.save(self.ref,self.mask,affine)
        with self.assertRaisesRegex(ValueError,"affine"):
            kits.audit_pair(self.ct,self.ref)
    def test_reject_undefined_reference_class(self):
        self.mask[9,9,9]=4
        self.save(self.ref,self.mask)
        with self.assertRaisesRegex(ValueError,"unknown KiTS23"):
            kits.audit_pair(self.ct,self.ref)


if __name__=="__main__":
    unittest.main()
