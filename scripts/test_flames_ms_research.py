#!/usr/bin/env python3
"""Only offline contract checks; synthetic masks ARE NOT real trained inference."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

SPEC=importlib.util.spec_from_file_location("flames",Path(__file__).with_name("flames_ms_research.py"))
flames=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(flames)


class FLAMeSContracts(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.inp=self.root/"inputs"
        self.inp.mkdir()
        self.source=self.inp/"mscase001_0000.nii.gz"
        self.mask=self.root/"brainmask"/"mscase001_mask.nii.gz"
        self.mask.parent.mkdir()
        self.output=self.root/"output"
        self.results=self.root/"results"
        self.results.mkdir()
        x,y,z=np.indices((32,32,32))
        self.brain=(((x-16)**2+(y-16)**2+(z-16)**2)<12**2).astype("uint8")
        self.intensity=self.brain * (200 + x*7 + y*3 + z).astype("float32")
        self.affine=np.diag([1.,1.,1.,1.])
        self.save(self.source,self.intensity)
        self.save(self.mask,self.brain)
        self.model=self.results/"Dataset004_WML"
        cfg=self.model/"nnUNetTrainer_8000epochs__nnUNetPlans__3d_fullres"
        ckpt=cfg/"fold_0"/"checkpoint_final.pth"
        ckpt.parent.mkdir(parents=True)
        ckpt.write_bytes(b"author-model-byte-placeholder-no-forward"*80)
        (self.model/"dataset.json").write_text(json.dumps({
            "channel_names":{"0":"FLAIR"}, "labels":{"background":0,"MS_lesion":1},
            "file_ending":".nii.gz"
        }))

    def tearDown(self):
        self.tmp.cleanup()

    def save(self,path,array):
        img=nib.Nifti1Image(array,self.affine)
        img.header.set_xyzt_units("mm")
        nib.save(img,str(path))

    def test_requires_skull_stripped_flair_and_exact_brain_mask(self):
        self.assertTrue(flames.check_inputs(self.source,self.mask)["sourceAndBrainMaskAligned"])
        self.intensity[0,0,0]=100
        self.save(self.source,self.intensity)
        with self.assertRaisesRegex(ValueError,"outside brain"):
            flames.check_inputs(self.source,self.mask)

    def test_model_requires_correct_original_trainer_and_ontology(self):
        report=flames.original_model_installation(self.results)
        self.assertEqual(report["folds"],["0"])
        self.assertEqual(report["trainer"],"nnUNetTrainer_8000epochs")
        (self.model/"dataset.json").write_text(json.dumps({
            "channel_names":{"0":"CT"},"labels":{"background":0,"WMH":2},"file_ending":".nii.gz"}))
        with self.assertRaisesRegex(ValueError,"labels"):
            flames.original_model_installation(self.results)

    def test_original_native_lesion_locations_and_masks(self):
        arr=np.zeros((32,32,32),dtype="uint8")
        arr[12:14,14:16,17:19]=1
        arr[22,22,22]=1
        pred=self.root/"pred.nii.gz"
        self.save(pred,arr)
        report=flames.evaluate_original_prediction(self.source,pred)
        self.assertEqual(report["modelCandidateComponentCount"],2)
        self.assertEqual(report["modelCandidateVoxels"],9)
        self.assertEqual(report["regionsOriginalSourceCoordinates"][0]["voxelCount"],8)
        self.assertFalse(report["clinicallyValidated"])
        self.assertFalse(report["canDifferentiateMSFromSmallVesselWMH"])
        arr[20,20,20]=2
        self.save(pred,arr)
        with self.assertRaisesRegex(ValueError,"nonbinary"):
            flames.evaluate_original_prediction(self.source,pred)

    def test_never_claims_original_forward_in_readiness(self):
        report=flames.run(self.source,self.mask,self.results,self.output,execute=False,device="cpu")
        self.assertIs(report["trueOriginalForward"],False)
        self.assertFalse(self.output.exists())
        self.assertFalse(report["independentReferenceCompared"])


if __name__=="__main__":
    unittest.main()
