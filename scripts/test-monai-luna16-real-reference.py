#!/usr/bin/env python3
"""Tiny deterministic contracts for one genuine stored public MONAI result."""
import importlib.util
import json
from pathlib import Path
import unittest

src=Path(__file__).with_name("compare-monai-luna16-real-reference.py")
spec=importlib.util.spec_from_file_location("monai_luna_reference",src)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def config():
    return {
        "num_classes":1,
        "preprocessing":{"transforms":[{"_target_":"LoadImaged","reader":"itkreader",
                                         "affine_lps_to_ras":True}]},
        "postprocessing":{"transforms":[
            {"_target_":"AffineBoxToWorldCoordinated","affine_lps_to_ras":True},
            {"_target_":"ConvertBoxModed","src_mode":"xyzxyz","dst_mode":"cccwhd"}]},
    }

class ReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model=json.loads(m.MODEL_REPORT.read_text())
        cls.geometry={"origin":(-200.,-200.,-200.),
                      "spacing":(.78125,.78125,2.5),
                      "matrix":[[1.,0.,0.],[0.,1.,0.],[0.,0.,1.]],
                      "dimensions":[512,512,109]}
    def test_same_lps_world_coordinates_can_match_reference_center(self):
        center=self.model["candidates"][0]["centerMonaiWorldMm"]
        reference={"centerLpsMm":[center[0]+1,center[1],center[2]],"diameterMm":6.}
        result=m.compare(self.model,reference,self.geometry,config())
        self.assertTrue(result["researchReferenceCenterHitAtScorePoint5"])
        self.assertEqual(result["researchCenterHitCandidateIndices"],[0])
        self.assertEqual(result["modelCandidatesCompared"][0]["centerDistanceToExpertMm"],1.)
        self.assertFalse(result["independentClinicalValidation"])
        self.assertIsNone(result["dice"])
        self.assertIsNone(result["externalValidationSensitivity"])
        self.assertFalse(result["datasetHoldoutFromModelTrainingVerified"])
    def test_low_score_candidate_cannot_be_claimed_detected_at_point5(self):
        low=self.model["candidates"][1]["centerMonaiWorldMm"]
        reference={"centerLpsMm":low,"diameterMm":3.}
        result=m.compare(self.model,reference,self.geometry,config())
        self.assertFalse(result["researchReferenceCenterHitAtScorePoint5"])
        self.assertTrue(result["modelCandidatesCompared"][1]["withinExpertReferenceRadius"])
        self.assertFalse(result["modelCandidatesCompared"][1]["acceptedAtResearchScorePoint5"])
    def test_vendor_lps_transform_cannot_be_guessed(self):
        sample=config()
        sample["postprocessing"]["transforms"][0]["affine_lps_to_ras"]=False
        with self.assertRaisesRegex(ValueError,"upstream_world_lps"):
            m.compare(self.model,{"centerLpsMm":[0,0,0],"diameterMm":8},
                      self.geometry,sample)
    def test_parse_source_geometry_without_real_pixels(self):
        raw=(f"ObjectType = Image\nNDims = 3\nElementType = MET_SHORT\n"
             f"ElementDataFile = {m.UID}.raw\nDimSize = 512 512 109\n"
             "ElementSpacing = 0.78125 0.78125 2.5\n"
             "Offset = -200 -200 -200\nTransformMatrix = 1 0 0 0 1 0 0 0 1\n").encode()
        g=m.parse_metaimage(raw)
        self.assertEqual(g["dimensions"],[512,512,109])
        self.assertEqual(m.voxel_index([-200,-200,-197.5],g),[0,0,1])
        with self.assertRaisesRegex(ValueError,"nonorthonormal"):
            m.parse_metaimage(raw.replace(b"1 0 0 0 1 0 0 0 1",b"2 0 0 0 1 0 0 0 1"))
    def test_modified_stored_model_evidence_rejected(self):
        center=self.model["candidates"][0]["centerMonaiWorldMm"]
        ref={"centerLpsMm":center,"diameterMm":6}
        corrupt=json.loads(json.dumps(self.model))
        corrupt["model"]["weightsSha256"]="f"*64
        with self.assertRaisesRegex(ValueError,"unbound"):
            m.compare(corrupt,ref,self.geometry,config())

if __name__=="__main__":
    unittest.main()
