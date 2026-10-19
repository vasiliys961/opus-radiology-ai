#!/usr/bin/env python3
"""Tests for pelvic fracture audit gates; fixtures are NOT model inference."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import nibabel as nib

FILE = Path(__file__).with_name("audit-pelvic-fracture-public-expert.py")
spec = importlib.util.spec_from_file_location("pelvic_fracture_audit", FILE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class PelvicFractureAudit(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        shape = (12, 12, 12)
        ct = np.full(shape, 100, np.int16)
        expert = np.zeros(shape, np.uint8)
        expert[2:4,2:4,2:4] = 1
        pred = np.zeros(shape, np.uint8)
        pred[3:5,2:4,2:4] = 1
        self.paths = [self.root/n for n in ("ct.nii.gz","expert.nii.gz","prediction.nii.gz")]
        for data, path in zip((ct,expert,pred),self.paths):
            image = nib.Nifti1Image(data, np.diag([1.,1.,1.,1.]))
            image.header.set_xyzt_units("mm")
            nib.save(image, str(path))
        self.provenance=self.root/"run.json"
        self.meta=dict(
            modelTask="pelvic_fracture_fragment_segmentation",
            sourceSha256=mod.sha256(self.paths[0]),
            expertSha256=mod.sha256(self.paths[1]),
            predictionSha256=mod.sha256(self.paths[2]),
            checkpointSha256="a"*64,vendorCodeCommit="b"*40,
            actualPretrainedInferenceCompleted=True,researchOnly=True)
        self.write_meta()

    def write_meta(self):
        self.provenance.write_text(json.dumps(self.meta))

    def audit(self):
        return mod.evaluate(*self.paths,self.provenance)

    def test_geometry_and_overlap(self):
        report=self.audit()
        self.assertEqual([report[x] for x in ("TP","FP","FN")],[4,4,4])
        self.assertEqual(report["voxelDice"],0.5)
        self.assertFalse(report["clinicalValidation"])
        self.assertTrue(report["inferenceAttestedBySuppliedManifestNotIndependentlyVerified"])

    def test_no_vendor_provenance_rejected(self):
        self.meta["actualPretrainedInferenceCompleted"]=False
        self.write_meta()
        with self.assertRaises(ValueError):self.audit()

    def test_changed_predictions_rejected(self):
        self.meta["predictionSha256"]="f"*64
        self.write_meta()
        with self.assertRaises(ValueError):self.audit()

    def test_wrong_affine_rejected(self):
        prediction=np.zeros((12,12,12),np.uint8)
        prediction[2,2,2]=1
        image=nib.Nifti1Image(prediction,np.diag([2.,1.,1.,1.]))
        image.header.set_xyzt_units("mm")
        nib.save(image,str(self.paths[2]))
        self.meta["predictionSha256"]=mod.sha256(self.paths[2])
        self.write_meta()
        with self.assertRaises(ValueError):self.audit()

    def test_bone_labels_not_fractures(self):
        im=nib.load(str(self.paths[2]))
        data=np.full(im.shape,11,np.uint8)
        image=nib.Nifti1Image(data,im.affine)
        image.header.set_xyzt_units("mm")
        nib.save(image,str(self.paths[2]))
        self.meta["predictionSha256"]=mod.sha256(self.paths[2])
        self.write_meta()
        with self.assertRaises(ValueError):self.audit()

    def test_no_expert_fracture_rejected(self):
        im=nib.load(str(self.paths[1]))
        image=nib.Nifti1Image(np.zeros(im.shape,np.uint8),im.affine)
        image.header.set_xyzt_units("mm")
        nib.save(image,str(self.paths[1]))
        self.meta["expertSha256"]=mod.sha256(self.paths[1])
        self.write_meta()
        with self.assertRaises(ValueError):self.audit()

if __name__=="__main__":
    unittest.main()
