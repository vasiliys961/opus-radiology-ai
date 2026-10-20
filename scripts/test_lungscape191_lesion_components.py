#!/usr/bin/env python3
"""Small, genuine NIfTI geometry/component contract; NOT pretrained forward."""
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np
from lungscape191_lesion_components import inspect_components


class TestOriginalGridComponents(unittest.TestCase):
    def test_two_components_and_native_center(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            aff = np.diag([1.5, 2.0, 2.5, 1.0])
            volume = np.zeros((16, 16, 16), dtype=np.uint8)
            volume[1:4, 2:5, 3:6] = 1
            volume[10:13, 10:13, 10:13] = 1
            ct = nib.Nifti1Image(np.zeros_like(volume), aff)
            pred = nib.Nifti1Image(volume, aff)
            ct.header.set_xyzt_units("mm")
            pred.header.set_xyzt_units("mm")
            a, z = root / "ct.nii.gz", root / "pred.nii.gz"
            nib.save(ct, a)
            nib.save(pred, z)
            report = inspect_components(a, z, {0: "background", 1: "high attenuation"})
            self.assertTrue(report["componentAnalysisCompleted"])
            self.assertEqual(report["componentsByOriginalLabel"]["1"]["allConnectedComponents"], 2)
            self.assertEqual(len(report["candidateComponents"]), 2)
            self.assertEqual([x["voxels"] for x in report["candidateComponents"]], [27, 27])
            self.assertEqual(report["candidateComponents"][0]["sourceVoxelBoundsInclusive"], [[1,2,3],[3,4,5]])
            self.assertFalse(report["clinicalValidation"])

    def test_wrong_geometry_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ct = nib.Nifti1Image(np.zeros((4,4,4), dtype=np.uint8), np.eye(4))
            pred = nib.Nifti1Image(np.ones((4,4,4), dtype=np.uint8), np.diag([2,1,1,1]))
            a,z=root/"a.nii.gz",root/"b.nii.gz"
            nib.save(ct,a); nib.save(pred,z)
            with self.assertRaises(ValueError):
                inspect_components(a,z,{0:"background",1:"high attenuation"})


if __name__ == "__main__":
    unittest.main()
