#!/usr/bin/env python3
"""No downloaded images or weights: exercise bounded native-grid evidence only."""
import json
from pathlib import Path
import tempfile
import unittest

from lungscape191_native_evidence import installed_label_map, inspect_native_prediction


class LungscapeNativeEvidenceContract(unittest.TestCase):
    def setUp(self):
        import nibabel as nib
        import numpy as np
        self.nib, self.np = nib, np
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.labels_path = self.root / "dataset.json"
        self.labels_path.write_text(json.dumps({
            "channel_names": {"0": "CT"},
            "labels": {"background": 0, "high_attenuation": 1},
            "file_ending": ".nii.gz",
        }), encoding="utf-8")
        affine = np.diag([1., 2., 3., 1.])
        src = nib.Nifti1Image(np.zeros((8, 9, 10), dtype=np.float32), affine)
        src.header.set_xyzt_units("mm")
        self.src = self.root / "case_0000.nii.gz"
        nib.save(src, self.src)
        arr = np.zeros((8, 9, 10), dtype=np.uint8)
        arr[2, 3, 4] = 1
        arr[2, 4, 4] = 1
        arr[3, 3, 5] = 1
        self.mask_arr = arr
        self.affine = affine
        self.mask = self.root / "case.nii.gz"
        self.write_mask(arr, affine)

    def write_mask(self, values, affine, millimetres=True):
        image = self.nib.Nifti1Image(values, affine)
        if millimetres:
            image.header.set_xyzt_units("mm")
        self.nib.save(image, self.mask)

    def test_original_label_ontology_native_bbox_mm_volume(self):
        labels = installed_label_map(self.labels_path)
        report = inspect_native_prediction(self.src, self.mask, labels)
        self.assertTrue(report["verifiedNativeGrid"])
        self.assertEqual(report["observedNonbackgroundModelVoxels"], 3)
        self.assertEqual(report["regionsByOriginalModelLabelNotConnectedLesions"][0][
            "sourceVoxelBoundsInclusive"], [[2, 3, 4], [3, 4, 5]])
        self.assertEqual(report["regionsByOriginalModelLabelNotConnectedLesions"][0][
            "sourceRasMmAxisAlignedBounds"], [[2., 6., 12.], [3., 8., 15.]])
        self.assertAlmostEqual(report["regionsByOriginalModelLabelNotConnectedLesions"][0][
            "volumeMl"], 0.018)
        self.assertTrue(report["ggoReticulationHoneycombingUIPNSIPNotClassified"])

    def test_reject_shifted_grid_even_when_shapes_identical(self):
        shifted = self.affine.copy()
        shifted[0, 3] = 2.
        self.write_mask(self.mask_arr, shifted)
        with self.assertRaisesRegex(ValueError, "grid mismatch"):
            inspect_native_prediction(self.src, self.mask, installed_label_map(self.labels_path))

    def test_reject_unknown_or_fractional_model_labels(self):
        bad = self.mask_arr.copy()
        bad[1, 1, 1] = 7
        self.write_mask(bad, self.affine)
        with self.assertRaisesRegex(ValueError, "absent from original"):
            inspect_native_prediction(self.src, self.mask, installed_label_map(self.labels_path))
        fractional = self.mask_arr.astype(self.np.float32)
        fractional[1, 1, 1] = 0.25
        self.write_mask(fractional, self.affine)
        with self.assertRaisesRegex(ValueError, "nonintegral"):
            inspect_native_prediction(self.src, self.mask, installed_label_map(self.labels_path))

    def test_reject_non_ct_or_missing_background_ontology(self):
        manifest = json.loads(self.labels_path.read_text())
        manifest["channel_names"]["0"] = "T1"
        self.labels_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "not verified CT"):
            installed_label_map(self.labels_path)
        manifest["channel_names"]["0"] = "CT"
        manifest["labels"] = {"white": 0, "opacity": 1}
        self.labels_path.write_text(json.dumps(manifest))
        with self.assertRaisesRegex(ValueError, "background"):
            installed_label_map(self.labels_path)

    def test_unknown_source_units_do_not_mint_mm_measurements(self):
        src = self.nib.load(str(self.src))
        src.header.set_xyzt_units("unknown")
        self.nib.save(src, self.src)
        self.write_mask(self.mask_arr, self.affine, millimetres=False)
        report = inspect_native_prediction(
            self.src, self.mask, installed_label_map(self.labels_path))
        self.assertFalse(report["sourceUnitMillimetresVerified"])
        entry = report["regionsByOriginalModelLabelNotConnectedLesions"][0]
        self.assertIsNone(entry["volumeMl"])
        self.assertIsNone(entry["sourceRasMmAxisAlignedBounds"])


    def test_unknown_source_with_nnunet_mm_export_retains_voxel_evidence(self):
        src = self.nib.load(str(self.src))
        src.header.set_xyzt_units("unknown")
        self.nib.save(src, self.src)
        self.write_mask(self.mask_arr, self.affine, millimetres=True)
        report = inspect_native_prediction(
            self.src, self.mask, installed_label_map(self.labels_path))
        self.assertTrue(report["verifiedNativeGrid"])
        self.assertTrue(report["spatialUnitsUncertain"])
        self.assertEqual(report["segmentationSpatialUnit"], "mm")
        self.assertFalse(report["sourceUnitMillimetresVerified"])
        self.assertIsNone(report["regionsByOriginalModelLabelNotConnectedLesions"][0]["volumeMl"])

if __name__ == "__main__":
    unittest.main()
