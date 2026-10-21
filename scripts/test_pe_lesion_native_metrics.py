#!/usr/bin/env python3
"""Only arithmetic tests. Do not present synthetic masks as disease evidence."""
import unittest
import numpy as np
from pe_lesion_native_metrics import score_pe_components

class LesionResearchContract(unittest.TestCase):
    def setUp(self):
        self.e = np.zeros((18,19,20), dtype=bool)
        self.p = np.zeros_like(self.e)
        self.affine = np.diag([1.5, 2.0, 2.5, 1.])
        self.affine[0,3] = 10.

    def test_detected_and_missed_original_source_coordinates(self):
        self.e[2:4,3:5,4:6] = True
        self.e[12:14,12:14,12:14] = True
        self.p[2:4,3:5,4:6] = True
        self.p[8:10,8:10,8:10] = True
        q = score_pe_components(self.e,self.p,self.affine,source_units_mm=True)
        self.assertEqual((q["expertConnectedPEComponents"],
                          q["modelConnectedPECandidates"],
                          q["expertPEComponentsMatchedOneToOne"],
                          q["expertPEComponentsMissed"],
                          q["unmatchedModelPEComponentsPerOneStudy"]), (2,2,1,1,1))
        self.assertEqual(q["singleStudyComponentRecall"],0.5)
        self.assertEqual(q["candidateLocationsOriginalSourceRasMm"][0]["originalSourceRasMmCentroid"],[13.75,7.0,11.25])

    def test_fusion_cannot_match_two_expert_lesions(self):
        self.e[2:4,3:5,4:6] = True
        self.e[8:10,3:5,4:6] = True
        self.p[2:10,3:5,4:6] = True
        q = score_pe_components(self.e,self.p,self.affine,source_units_mm=True)
        self.assertEqual(q["expertPEComponentsMatchedOneToOne"],1)
        self.assertEqual(q["expertPEComponentsMissed"],1)
        self.assertEqual(q["unmatchedModelPEComponentsPerOneStudy"],0)

    def test_unknown_source_units_suppress_mm_and_ml(self):
        self.e[2:4,3:5,4:6] = True
        self.p[2:4,3:5,4:6] = True
        q = score_pe_components(self.e,self.p,self.affine,source_units_mm=False)
        self.assertFalse(q["originalSourcePhysicalMillimetresVerified"])
        self.assertIsNone(q["candidateLocationsOriginalSourceRasMm"][0]["originalSourceRasMmCentroid"])
        self.assertIsNone(q["candidateLocationsOriginalSourceRasMm"][0]["candidateVolumeMl"])

    def test_no_expert_reference_rejected(self):
        with self.assertRaisesRegex(ValueError,"expert-positive"):
            score_pe_components(self.e,self.p,self.affine,source_units_mm=True)

    def test_mask_shape_mismatch_rejected(self):
        self.e[2,3,4] = True
        with self.assertRaisesRegex(ValueError,"source-matched"):
            score_pe_components(self.e,self.p[:10],self.affine,source_units_mm=True)

if __name__=="__main__":
    unittest.main()
