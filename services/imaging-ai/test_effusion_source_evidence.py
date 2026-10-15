#!/usr/bin/env python3
"""Synthetic-only labels; medically meaningful task-315 semantics with no model run."""
import tempfile
import unittest
from pathlib import Path
import numpy as np
import nibabel as nib
from effusion_source_evidence import run,digest

KEY="PUBLIC-OR-AUTHORIZED-CHEST-CT-RESEARCH-OK"
def write(path,values,affine):
    image=nib.Nifti1Image(values,affine)
    image.header.set_xyzt_units("mm")
    image.set_sform(affine,code=1)
    image.set_qform(affine,code=0)
    nib.save(image,str(path))
    return path

class PleuralAndPericardialResearch(unittest.TestCase):
    def make(self,root):
        a=np.diag([.8,.8,2.5,1.])
        source=write(root/"original-chest.nii",
            np.ones((16,16,8),dtype=np.int16)*-700,a)
        mask=np.zeros((16,16,8),np.uint8)
        mask[1:12,1:12,2:7]=1  # lung-pleural anatomical label: NOT FLUID
        mask[3:5,5:7,3:5]=2 # pleural effusion model proposal
        mask[9:11,9:11,5]=3 # pericardial effusion model proposal
        segment=write(root/"output-actual-model-labelmap.nii.gz",mask,a)
        return source,segment,mask,a
    def test_both_pathology_labels_and_original_source_slices(self):
        with tempfile.TemporaryDirectory() as d:
            source,mask,_,_=self.make(Path(d))
            result=run(source,mask,digest(source),"f"*64,KEY)
            pleural,pericardial=result["fluidCandidates"]
            self.assertEqual(pleural["modelPositiveNativeVoxelCount"],8)
            self.assertEqual(pericardial["modelPositiveNativeVoxelCount"],4)
            self.assertAlmostEqual(pleural["modelUnvalidatedFluidLabelVolumeMl"],.0128)
            self.assertEqual(pleural["nativeSourceSliceIndicesK"],[3,4])
            self.assertEqual(pericardial["nativeIndexBoundsXYZMin"],[9,9,5])
            self.assertGreater(result["anatomicalClassLungPleuralVoxelCountNotFluid"],100)
            self.assertTrue(result["anatomicalClassLungPleuralIdOneExcludedFromPathology"])
            self.assertFalse(result["clinicalNormalityCanBeConcluded"])
            self.assertFalse(result["clinicalValidation"])
            self.assertFalse(result["actualPretrainedInferenceProvenByThisMaskAlone"])
    def test_no_detected_label_still_cannot_rule_out_fluid(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src,_,mask,affine=self.make(root)
            mask[mask>=2]=0
            out=write(root/"anatomic-only.nii.gz",mask,affine)
            result=run(src,out,digest(src),"f"*64,KEY)
            self.assertEqual([x["modelPositiveNativeVoxelCount"] for x in result["fluidCandidates"]],[0,0])
            self.assertTrue(all(not c["clinicalAbsenceIfEmptyEstablished"] for c in result["fluidCandidates"]))
    def test_nonfluid_or_unexpected_label_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src,_,mask,affine=self.make(root)
            mask[0,0,0]=4
            out=write(root/"wrong-class.nii.gz",mask,affine)
            with self.assertRaisesRegex(ValueError,"unexpected_model_label"):
                run(src,out,digest(src),"f"*64,KEY)
    def test_source_geometry_and_original_hash_must_match(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src,_,mask,affine=self.make(root)
            affine[0,3]=5
            out=write(root/"shifted.nii.gz",mask,affine)
            with self.assertRaisesRegex(ValueError,"not_registered"):
                run(src,out,digest(src),"f"*64,KEY)
            with self.assertRaisesRegex(ValueError,"different_real_original_ct"):
                run(src,out,"a"*64,"f"*64,KEY)
            with self.assertRaisesRegex(ValueError,"authorization"):
                run(src,out,digest(src),"f"*64,"")
if __name__=="__main__":unittest.main()
