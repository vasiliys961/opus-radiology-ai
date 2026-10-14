#!/usr/bin/env python3
"""Numerical expert-subtype coverage contracts; NEVER a trained inference run."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
import nibabel as nib
import numpy as np

p=Path(__file__).with_name("ich-expert-subtype-coverage.py")
spec=importlib.util.spec_from_file_location("ich_subtype_coverage",p)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class ExpertSubtypeCoverage(unittest.TestCase):
    def example(self):
        original=np.zeros((12,12,6),dtype=np.uint8)
        original[1:3,1:3,1:3]=1  # 8 IPH
        original[6:8,1:3,1:3]=2  # 8 SAH
        binary=original>0
        pred=np.zeros(binary.shape,dtype=bool)
        pred[1:2,1:3,1:3]=True  # 4 / 8 IPH
        pred[10,10,4]=True  # one false positive
        return original,binary,pred,{"truePositiveVoxels":4,"falseNegativeVoxels":12,
                                   "falsePositiveVoxels":1}

    def test_real_model_overlap_is_partitioned_by_source_expert_labels(self):
        original,binary,pred,metrics=self.example()
        result=mod.measure_coverage(pred,binary,original,{1:"IPH",2:"SAH"},
                                   {"1":8,"2":8},metrics,.002)
        self.assertEqual(result["totalOverlappingExpertVoxels"],4)
        self.assertEqual(result["totalMissedExpertVoxels"],12)
        ip,sa=result["expertVoxelClasses"]
        self.assertEqual(ip["voxelCoverageFraction"],.5)
        self.assertEqual(ip["modelMissedExpertVolumeMl"],.008)
        self.assertEqual(ip["modelOverlappingExpertVolumeMl"],.008)
        self.assertEqual(sa["modelMissedExpertVolumeMl"],.016)
        self.assertEqual(sa["voxelCoverageFraction"],0)
        self.assertEqual(ip["peakMissedSliceIndexK"],1)
        self.assertEqual(ip["peakMissedSliceVoxels"],2)
        self.assertEqual(sa["peakMissedSliceIndexK"],1)
        self.assertEqual(sa["peakMissedSliceVoxels"],4)
        self.assertFalse(ip["modelPredictedSubtype"])
        self.assertIsNone(result["clinicalSubtypeSensitivity"])

    def test_original_mask_cannot_invent_extra_classes_or_different_union(self):
        original,binary,pred,metrics=self.example()
        wrong=binary.copy()
        wrong[6,1,1]=False
        with self.assertRaisesRegex(ValueError,"union"):
            mod.measure_coverage(pred,wrong,original,{1:"IPH",2:"SAH"},
                                 {"1":8,"2":8},metrics,.002)
        original[6,1,1]=3
        with self.assertRaisesRegex(ValueError,"union|label_count"):
            mod.measure_coverage(pred,binary,original,{1:"IPH",2:"SAH"},
                                 {"1":8,"2":8},metrics,.002)

    def test_denominator_absence_is_not_clinical_zero_sensitivity(self):
        original,binary,pred,metrics=self.example()
        result=mod.measure_coverage(pred,binary,original,{1:"IPH",2:"SAH",3:"SDH"},
                                   {"1":8,"2":8,"3":0},metrics,.002)
        self.assertIsNone(result["expertVoxelClasses"][2]["voxelCoverageFraction"])
        self.assertIsNone(result["expertVoxelClasses"][2]["peakMissedSliceIndexK"])
        self.assertIsNone(result["expertVoxelClasses"][2]["peakMissedSliceVoxels"])
        self.assertFalse(result["modelSubtypeClassifierExecuted"])

    def test_source_grid_bound_file_evidence_preserves_original_sha(self):
        original,binary,pred,metrics=self.example()
        with tempfile.TemporaryDirectory() as td:
            folder=Path(td)
            affine=np.diag([.7,.7,2.5,1])
            def save(name,array):
                image=nib.Nifti1Image(array,affine)
                image.header.set_xyzt_units("mm")
                image.set_sform(affine,code=2)
                file=folder/name
                nib.save(image,str(file))
                return file
            source=save("source.nii.gz",np.zeros(original.shape,dtype=np.int16))
            prediction=save("prediction.nii.gz",pred.astype(np.uint8))
            derived=save("derived.nii.gz",binary.astype(np.uint8))
            expert=save("original.nii.gz",original)
            ontology=folder/"ontology.json"
            ontology.write_text(json.dumps({
                "sourceUrl":"https://example.org/authoritative-labels",
                "labelMeaning":{"1":"IPH","2":"SAH"}
            }))
            result=mod.score_source_bound_case(
                source,prediction,derived,expert,ontology,
                {"1":8,"2":8},metrics)
            self.assertEqual(result["totalOverlappingExpertVoxels"],4)
            self.assertEqual(result["evidenceHashes"]["originalExpertMaskSha256"],
                             __import__("hashlib").sha256(expert.read_bytes()).hexdigest())
            self.assertEqual(result["ontologySourceUrl"],
                             "https://example.org/authoritative-labels")

    def test_no_missing_pixels_produces_no_invented_ct_target(self):
        original,binary,_,_=self.example()
        predicted=binary.copy()
        metrics={"truePositiveVoxels":16,"falseNegativeVoxels":0,"falsePositiveVoxels":0}
        out=mod.measure_coverage(predicted,binary,original,{1:"IPH",2:"SAH"},
                                 {"1":8,"2":8},metrics,.002)
        for row in out["expertVoxelClasses"]:
            self.assertIsNone(row["peakMissedSliceIndexK"])
            self.assertIsNone(row["peakMissedSliceVoxels"])

    def test_malformed_metrics_cannot_report_coverages(self):
        original,binary,pred,metrics=self.example()
        metrics["falseNegativeVoxels"]=10
        with self.assertRaisesRegex(ValueError,"per_subtype_totals"):
            mod.measure_coverage(pred,binary,original,{1:"IPH",2:"SAH"},
                                 {"1":8,"2":8},metrics,.002)


if __name__=="__main__":
    unittest.main()
