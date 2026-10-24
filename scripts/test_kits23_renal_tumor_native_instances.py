#!/usr/bin/env python3
import importlib.util
import pathlib
import unittest
import numpy as np

source=pathlib.Path(__file__).with_name("score-kits23-original-renal-tumor.py")
spec=importlib.util.spec_from_file_location("renal_score",source)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class NativeLocalization(unittest.TestCase):
    def test_world_coordinates_and_volume(self):
        arr=np.zeros((20,20,20),dtype=np.uint8)
        arr[2:4,4:7,5:9]=1
        affine=np.diag([2.,1.,3.,1.])
        affine[:3,3]=[10,20,30]
        result=module.localize_tumor_instances(arr,affine)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]["candidateVoxels"],24)
        self.assertAlmostEqual(result[0]["candidateVolumeMl"],0.144,5)
        self.assertEqual(result[0]["sourceNativeVoxelBoundsInclusive"],[[2,3],[4,6],[5,8]])
        self.assertEqual(result[0]["sourceRASCentroidMm"],[15.,25.,49.5])
        self.assertFalse(result[0]["malignancyConfirmed"])
    def test_no_candidate_does_not_prove_normal(self):
        self.assertEqual(module.localize_tumor_instances(np.zeros((20,20,20),np.uint8),np.eye(4)),[])
    def test_bad_affine_refused(self):
        with self.assertRaises(ValueError):
            module.localize_tumor_instances(np.zeros((20,20,20),np.uint8),np.zeros((4,4)))
if __name__=="__main__":
    unittest.main()
