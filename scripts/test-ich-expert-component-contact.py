#!/usr/bin/env python3
"""Synthetic numerical contracts only; not a real CT or a model accuracy test."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

file = Path(__file__).with_name("ich-expert-component-contact.py")
spec = importlib.util.spec_from_file_location("ich_components", file)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ComponentContactTest(unittest.TestCase):
    def test_two_separate_expert_fragments_contact_one_model_fragment(self):
        expert = np.zeros((12, 12, 6), dtype=bool)
        predicted = np.zeros_like(expert)
        expert[1:3, 1:3, 1:3] = True
        expert[6:8, 1:3, 1:3] = True
        predicted[2:7, 1, 1] = True
        predicted[10, 10, 4] = True
        metrics = {
            "truePositiveVoxels": 2, "falsePositiveVoxels": 4,
            "falseNegativeVoxels": 14
        }
        out = module.component_overlap_evidence(predicted, expert, .002, metrics)
        self.assertEqual(out["expertFragmentsTotal"], 2)
        self.assertEqual(out["predictedFragmentsTotal"], 2)
        self.assertEqual(out["expertFragmentsWithAnyVoxelOverlap"], 2)
        self.assertEqual(out["expertFragmentsWithZeroOverlap"], 0)
        self.assertEqual(out["predictedFragmentsWithZeroOverlap"], 1)
        self.assertEqual(out["predictedFragmentsContactingMultipleExpertFragments"], 1)
        self.assertEqual(out["clinicalLesionSensitivity"], None)
        self.assertFalse(out["hemorrhageSubtypesDetermined"])
        self.assertEqual(out["largestExpertFragments"][0]["volumeMl"], .016)

    def test_empty_masks_are_not_perfect_detection(self):
        empty = np.zeros((12, 12, 6), dtype=bool)
        out = module.component_overlap_evidence(empty, empty, .001, {
            "truePositiveVoxels": 0, "falsePositiveVoxels": 0,
            "falseNegativeVoxels": 0
        })
        self.assertEqual(out["expertFragmentsTotal"], 0)
        self.assertIsNone(out["clinicalLesionSensitivity"])

    def test_bad_voxel_totals_and_nonbinary_inputs_are_refused(self):
        p = np.zeros((12, 12, 6), dtype=bool)
        p[1, 1, 1] = True
        empty = np.zeros_like(p)
        with self.assertRaisesRegex(ValueError, "components_disagree"):
            module.component_overlap_evidence(p, empty, .001, {
                "truePositiveVoxels": 1, "falsePositiveVoxels": 0,
                "falseNegativeVoxels": 0
            })
        with self.assertRaisesRegex(ValueError, "unsupported_3d_binary"):
            module.component_overlap_evidence(p.astype(np.uint8), empty, .001, {
                "truePositiveVoxels": 0, "falsePositiveVoxels": 1,
                "falseNegativeVoxels": 0
            })


if __name__=="__main__":
    unittest.main()
