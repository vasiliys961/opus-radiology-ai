#!/usr/bin/env python3
"""Synthetic geometry-only checks, no real CT, no weights, no clinical claim."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np
import nibabel as nib

src=Path(__file__).with_name("ianpan_source_roi.py")
spec=importlib.util.spec_from_file_location("ianpan_source_roi",src)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def candidate(box,z=2):
    return [{
        "sliceIndexModelOrdered":z,"class":"subarachnoid",
        "modelInputBoundingBoxXY":box,
        "rawUncalibratedScore":0.91,
    }]

class ProjectionTests(unittest.TestCase):
    def test_ras_nifti_flip_and_center_padding_correctly_inverted(self):
        # RAS+ native axes -> LPS+ orientation in actual pinned vendor loader:
        # x / y are both reversed; every small source slice is centered padded.
        affine=np.diag([.8,.8,2.,1.])
        affine[:3,3]=[10.,20.,-30.]
        nii=nib.Nifti1Image(np.zeros((256,256,8),np.float32),affine)
        found=module.map_ich_model_regions_to_nifti(nii,candidate([255,250,258,253]))[0]["sourceVoxelProjection"]
        self.assertEqual(found["boundingBoxNativeNiftiXYZ"],[125,130,2,128,133,2])
        np.testing.assert_allclose(found["boundingBoxWorldRasMm"],
                                   [110.,124.,-26.,112.4,126.4,-26.],atol=.001)
        self.assertEqual(found["projectionMethod"],
                         "vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1")
        self.assertFalse(found["independentlyClinicallyVerified"])
        self.assertFalse(found["expertMaskCompared"])

    def test_lps_affine_no_flip_and_roi_clipped_to_real_footprint(self):
        affine=np.diag([-1.,-1.,2.,1.])
        nii=nib.Nifti1Image(np.zeros((256,256,8),np.float32),affine)
        found=module.map_ich_model_regions_to_nifti(nii,candidate([126,126,131,131]))[0]["sourceVoxelProjection"]
        self.assertEqual(found["boundingBoxNativeNiftiXYZ"],[0,0,2,3,3,2])
        self.assertTrue(found["trimmedOutsideOriginalCT"])
        self.assertEqual(found["boundingBoxWorldRasMm"],[-3.,-3.,4.,0.,0.,4.])
        none=module.map_ich_model_regions_to_nifti(nii,candidate([2,4,12,18]))[0]
        self.assertIsNone(none["sourceVoxelProjection"])
        self.assertEqual(none["modelInputBoundingBoxXY"],[2,4,12,18])
        no_heatmap=module.map_ich_model_regions_to_nifti(nii,candidate(None))[0]
        self.assertIsNone(no_heatmap["sourceVoxelProjection"])

    def test_swapped_physical_axes_reorient_to_lps_without_guessing(self):
        affine=np.eye(4)
        affine[:3,:3]=[[0.,-0.7,0.],[-0.8,0.,0.],[0.,0.,2.]]
        nii=nib.Nifti1Image(np.zeros((256,320,8),np.float32),affine)
        # LPS width = 320, height = 256, model padding left=96, top=128.
        hit=module.map_ich_model_regions_to_nifti(nii,candidate([96,128,100,131]))[0]["sourceVoxelProjection"]
        self.assertEqual(hit["boundingBoxNativeNiftiXYZ"],[0,0,2,3,4,2])
        self.assertFalse(hit["trimmedOutsideOriginalCT"])

    def test_bogus_z_rejected_and_no_fake_roi(self):
        nii=nib.Nifti1Image(np.zeros((256,256,8),np.float32),np.eye(4))
        with self.assertRaisesRegex(ValueError,"slice_out_of_range"):
            module.map_ich_model_regions_to_nifti(nii,candidate([200,200,201,201],z=40))
        with self.assertRaisesRegex(ValueError,"invalid_model_heatmap_box"):
            module.map_ich_model_regions_to_nifti(nii,candidate([500,10,7,11]))
        with self.assertRaisesRegex(ValueError,"invalid_model_heatmap_box"):
            module.map_ich_model_regions_to_nifti(nii,candidate([0,0,512,40]))

if __name__=="__main__":
    unittest.main()
