#!/usr/bin/env python3
"""Synthetic Boolean-mask contracts; never a model accuracy benchmark."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

target=Path(__file__).with_name("ich-native-slice-evidence.py")
spec=importlib.util.spec_from_file_location("ich_slice_audit",target)
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class NativeSliceEvidenceTests(unittest.TestCase):
    def test_missed_and_extra_candidates_are_source_indexed(self):
        p=np.zeros((8,8,5),dtype=bool)
        e=np.zeros_like(p)
        e[1:3,1:3,1]=True
        e[1:3,1:3,2]=True
        p[1:3,1:3,2]=True
        p[5:7,5:7,4]=True
        result=audit.analyze_slices(p,e,2,{
            "truePositiveVoxels":4,"falsePositiveVoxels":4,"falseNegativeVoxels":4
        })
        self.assertEqual(result["expertPositiveSlices"],2)
        self.assertEqual(result["expertPositiveSlicesWithVoxelOverlap"],1)
        self.assertEqual(result["expertPositiveSlicesWithoutOverlap"],[1])
        self.assertEqual(result["modelOnlyCandidateSlices"],[4])
        self.assertEqual(result["sliceEvidence"][2]["sliceDice"],1.0)
        self.assertIsNone(result["sliceEvidence"][0]["sliceDice"])
        self.assertIsNone(result["clinicalSliceSensitivity"])
        self.assertFalse(result["originalDicomSopMapped"])

    def test_invalid_axis_and_inconsistent_3d_voxels_refused(self):
        z=np.zeros((8,8,5),dtype=bool)
        for axis in (3,-1,None,"2",True):
            with self.assertRaises(ValueError):
                audit.analyze_slices(z,z,axis,{
                    "truePositiveVoxels":0,"falsePositiveVoxels":0,"falseNegativeVoxels":0
                })
        with self.assertRaisesRegex(ValueError,"do_not_match"):
            audit.analyze_slices(z,z,2,{
                "truePositiveVoxels":1,"falsePositiveVoxels":0,"falseNegativeVoxels":0
            })


if __name__=="__main__":
    unittest.main()
