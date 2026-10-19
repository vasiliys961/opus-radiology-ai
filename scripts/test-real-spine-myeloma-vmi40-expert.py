#!/usr/bin/env python3
"""Protocol/geometry safety contract only, NOT a measured medical model."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location("mm",Path(__file__).with_name("real-spine-myeloma-vmi40-expert.py"))
mm=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mm)

class Contract(unittest.TestCase):
    def test_real_model_protocol_is_not_generic_ct(self):
        self.assertIn("VMI_40",mm.LESION_DATASET)
        self.assertIn("Spine",mm.SPINE_DATASET)
        self.assertNotEqual(mm.SPINE_DATASET,mm.LESION_DATASET)
        self.assertEqual(len(mm.OFFICIAL_SCRIPT_BLOB),40)

    def test_voxel_confusion_exact(self):
        source=np.array([[[1,0],[0,1]]],dtype=np.uint8)
        pred=np.array([[[1,1],[0,0]]],dtype=np.uint8)
        self.assertEqual(mm.evaluate_arrays(pred,source),(1,1,1))

    def test_invalid_masks_fail(self):
        y=np.zeros((2,2,2),dtype=np.uint8)
        for val in [2,27,255]:
            with self.assertRaises(ValueError):
                mm.evaluate_arrays(np.full(y.shape,val),y)
        with self.assertRaises(ValueError):
            mm.evaluate_arrays(np.zeros((3,2,2),dtype=np.uint8),y)

    def test_unverified_publisher_weights_not_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                mm.inspect_models(Path(tmp))
        with self.assertRaises(ValueError):
            mm.bounded(Path("/file/that/never/exists.nii.gz"))

if __name__=="__main__":
    unittest.main()
