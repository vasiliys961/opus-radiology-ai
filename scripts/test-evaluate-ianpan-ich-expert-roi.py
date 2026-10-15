#!/usr/bin/env python3
"""Synthetic-only contract tests; NO public or private patient CT downloaded."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import nibabel as nib


def load_module(path,name):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(path))
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

m=load_module("evaluate-ianpan-ich-expert-roi.py","real_ich_roi_vs_true_blood")

def write_nii(path,data,affine=None):
    affine=np.diag([.75,.75,3.,1.]) if affine is None else affine
    nii=nib.Nifti1Image(data,affine)
    nii.header.set_xyzt_units("mm")
    nii.set_sform(affine,code=2)
    nii.set_qform(affine,code=0)
    nib.save(nii,str(path))
    return path


def fixture(tmp):
    root=Path(tmp)
    source=write_nii(root/"original-source.nii",np.zeros((16,16,8),dtype=np.int16))
    mask=np.zeros((16,16,8),dtype=np.uint8)
    mask[2:5,2:5,3:6]=1
    expert=write_nii(root/"original-independent-blood-mask.nii",mask)
    source_hash=m.evaluator_module().sha256(source)
    expert_hash=m.evaluator_module().sha256(expert)
    meaning={"sourceUrl":"https://example.org/independent-annotator/source-ontology",
             "labelMeaning":{"1":"IPH"}}
    ontology=root/"source-ontology.json";ontology.write_text(json.dumps(meaning))
    provenance={
        "schema":"opus-ich-external-hematoma-reference-admission/v1",
        "sourceCtSha256":source_hash,
        "originalExpertMaskSha256":expert_hash,
        "originalOntologySha256":m.evaluator_module().sha256(ontology),
        "annotationTissue":"HEMORRHAGE_BLOOD_NOT_EDEMA",
        "maskWasDrawnIndependentlyOfEvaluatedModel":True,
        "originalExpertLabelmapUnmodified":True,
        "referenceDatasetResearchRightsReviewed":True,
        "researchUseAuthorized":True,
        "expertReferenceAuthenticityIndependentlyAuditedByOpus":False,
        "sourceNiftiGridResampledForEvaluation":False,
        "originalExpertMaskCitationUrl":"https://example.org/independent-annotator/mask",
        "sourceDatasetUrl":"https://example.org/independent-annotator/ct",
        "labelOntology":{"1":"IPH"},
    }
    manifest=root/"blood-ontology-admission.json"
    manifest.write_text(json.dumps(provenance))
    report={
        "schema":"opus-ianpan-genuine-public-ich-research/v1",
        "status":"genuine_pretrained_inference_requires_independent_validation",
        "model":{"id":"ianpan/ct-head-hemorrhage-detection",
                 "revision":"e6d89c2","checkpointSha256Verified":True,
                 "sha256ByArtifact":{"inference.py":m.MODEL_SOURCE_HASH}},
        "source":{"niftiSha256":source_hash,"sourceDimensionsXYZ":[16,16,8],
                  "modelOrderedSliceCount":8,
                  "researchRoiVoxelGeometryProjectionAvailable":True},
        "externalExpertHemorrhageLocalizationComparisonPerformed":False,
        "readyForClinicalUse":False,"modelInputHeatmapsAreSourceAligned":False,
        "dice":None,"sensitivity":None,
        "candidates":[{
           "class":"intraparenchymal","sliceIndexModelOrdered":4,
           "rawUncalibratedScore":.97,"clinicallyConfirmed":False,
           "sourceVoxelProjection":{
             "projectionMethod":"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1",
             "independentlyClinicallyVerified":False,"expertMaskCompared":False,
             "boundingBoxNativeNiftiXYZ":[2,2,4,4,4,4]
           },
        },{
           "class":"any","sliceIndexModelOrdered":4,
           "rawUncalibratedScore":.98,"clinicallyConfirmed":False,
           "sourceVoxelProjection":{
             "projectionMethod":"vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1",
             "independentlyClinicallyVerified":False,"expertMaskCompared":False,
             "boundingBoxNativeNiftiXYZ":[2,2,4,4,4,4]
           }
        }]
    }
    report_path=root/"real-model-contract.json";report_path.write_text(json.dumps(report))
    args=argparse.Namespace(source=str(source),expert_mask=str(expert),
        source_sha256=source_hash,expert_sha256=expert_hash,
        genuine_model_report=str(report_path),original_ontology=str(ontology),
        reference_manifest=str(manifest),output=str(root/"spatial-review.json"),
        permission_token="REVIEW-TRUE-HEMORRHAGE-REFERENCE",rights_attested=True)
    return args,provenance,report,mask


class TestGenuineIchRoiBloodReference(unittest.TestCase):
    def test_real_model_interface_vs_separate_true_blood_mask_has_only_box_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,_,_,_=fixture(tmp)
            result=m.run(args)
            self.assertEqual(result["schema"],m.REPORT_SCHEMA)
            self.assertEqual(result["referenceDescription"],"HEMORRHAGE_BLOOD_NOT_EDEMA")
            p=result["referenceClasses"][0]
            self.assertEqual(p["referenceClass"],"IPH")
            self.assertEqual(p["referencePositiveVoxels"],27)
            self.assertEqual(p["expertVoxelsInsideModelBoxUnion"],9)
            self.assertAlmostEqual(p["expertVoxelShareInsideModelBoxes"],1/3,places=6)
            self.assertEqual(p["expertComponentsTotal"],1)
            self.assertEqual(p["expertComponentsWithBoxIntersection"],1)
            self.assertEqual(p["subtypeCandidateBoxes"],1) # class "any" is not extra lesion
            self.assertIsNone(p["modelPredictedHematomaVolumeMl"])
            self.assertFalse(p["geometricBoxContactIsClinicalTruePositive"])
            self.assertIsNone(result["hematomaSegmentationDice"])
            self.assertIsNone(result["clinicalTruePositiveCount"])
            self.assertIsNone(result["clinicalSensitivity"])
            self.assertFalse(result["clinicalValidation"])
            self.assertFalse(result["referenceAnnotationAuthenticityIndependentlyAuditedByOpus"])
            self.assertTrue(Path(args.output).is_file())
    def test_rejects_figshare_edema_mask_even_if_operator_claims_blood(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,manifest,_,_=fixture(tmp)
            manifest["originalExpertMaskCitationUrl"]="https://figshare.com/articles/dataset/PHE-SICH-CT-IDS/23957937"
            Path(args.reference_manifest).write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"edema_is_not_hematoma"):
                m.run(args)
            self.assertFalse(Path(args.output).exists())
    def test_rejects_unsupported_labels_and_forged_expert_ontology(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,manifest,_,mask=fixture(tmp)
            mask[1,1,1]=2  # unknowable tissue type, not a blood label
            write_nii(Path(args.expert_mask),mask)
            args.expert_sha256=m.evaluator_module().sha256(Path(args.expert_mask))
            manifest["originalExpertMaskSha256"]=args.expert_sha256
            Path(args.reference_manifest).write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"unknown_or_edema_label"):
                m.run(args)
            manifest["annotationTissue"]="PERIHEMATOMAL_EDEMA"
            Path(args.reference_manifest).write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"reference_provenance"):
                m.run(args)
    def test_rejects_shifted_expert_grid_even_when_shape_matches(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,manifest,_,mask=fixture(tmp)
            affine=np.diag([.75,.75,3.,1.]);affine[0,3]=5.
            write_nii(Path(args.expert_mask),mask,affine)
            args.expert_sha256=m.evaluator_module().sha256(Path(args.expert_mask))
            manifest["originalExpertMaskSha256"]=args.expert_sha256
            Path(args.reference_manifest).write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"grids_do_not_match"):
                m.run(args)
    def test_never_call_empty_model_region_a_healthy_ct(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,manifest,report,_=fixture(tmp)
            report["candidates"]=[]
            Path(args.genuine_model_report).write_text(json.dumps(report))
            result=m.run(args)
            p=result["referenceClasses"][0]
            self.assertEqual(p["expertVoxelsInsideModelBoxUnion"],0)
            self.assertEqual(p["expertReferenceNotCoveredVoxels"],27)
            self.assertEqual(p["subtypeCandidateBoxes"],0)
            self.assertIsNone(result["clinicalSensitivity"])
            self.assertFalse(result["clinicalValidation"])
    def test_refuses_candidate_bbox_outside_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,_,report,_=fixture(tmp)
            report["candidates"][0]["sourceVoxelProjection"]["boundingBoxNativeNiftiXYZ"]=[0,0,4,100,4,4]
            Path(args.genuine_model_report).write_text(json.dumps(report))
            with self.assertRaisesRegex(ValueError,"model_bbox"):
                m.run(args)
    def test_refuses_reference_without_explicit_license_attestation(self):
        with tempfile.TemporaryDirectory() as tmp:
            args,manifest,_,_=fixture(tmp)
            manifest["researchUseAuthorized"]=False
            Path(args.reference_manifest).write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,"provenance"):
                m.run(args)
            args.rights_attested=False
            with self.assertRaisesRegex(ValueError,"rights"):
                m.run(args)


if __name__=="__main__":
    unittest.main()
