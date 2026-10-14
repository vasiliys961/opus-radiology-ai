#!/usr/bin/env python3
"""Unit contract with synthetic labels ONLY, not a clinical-model validation run."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import nibabel as nib
import numpy as np

target = Path(__file__).with_name("evaluate-ich-public-mask.py")
spec = importlib.util.spec_from_file_location("ich_public_reference", target)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def saved_nifti(path, array, affine=None):
    if affine is None:
        affine = np.diag([0.7, 0.7, 2.5, 1])
    nii = nib.Nifti1Image(array, affine)
    nii.header.set_xyzt_units("mm")
    nii.set_sform(affine, code=2)
    nii.set_qform(affine, code=0)
    nib.save(nii, str(path))
    return path


def example(tmp):
    root = Path(tmp)
    shape = (16, 16, 16)
    ct = np.zeros(shape, dtype=np.int16)
    pred = np.zeros(shape, dtype=np.uint8)
    gt = np.zeros(shape, dtype=np.uint8)
    pred[2:4, 2:4, 2:4] = 1
    gt[3:5, 2:4, 2:4] = 1
    a = saved_nifti(root / "source.nii.gz", ct)
    b = saved_nifti(root / "prediction.nii.gz", pred)
    c = saved_nifti(root / "expert.nii.gz", gt)
    voxel_ml = 0.7 * 0.7 * 2.5 / 1000
    report = {
        "schema": "opus-ich-samihs-public-research/v1",
        "model": {"modelWeightsUsed": True},
        "source": {
            "sha256": module.sha256(a), "patientData": False,
            "sourceDicomSopBound": False,
            "geometry": {
                "dimensions": list(shape), "voxelVolumeMl": voxel_ml,
                "affineRas": nib.load(str(a)).affine.tolist()
            }
        },
        "prediction": {
            "maskSha256": module.sha256(b),
            "predictedPositiveVoxelCount": 8,
            "predictedMaskVolumeMl": round(8 * voxel_ml, 5)
        },
        "validation": {"clinicalValidation": False}
    }
    rp = root / "report.json"
    rp.write_text(json.dumps(report))
    args = argparse.Namespace(
        source=str(a), prediction=str(b), reference=str(c), report=str(rp),
        reference_sha256=module.sha256(c), output=str(root / "quality.json"),
        reference_label=1, public_research_authorization="PUBLIC-ICH-REFERENCE-REVIEW",
        rights_attested=True,
    )
    return args


class TestIchMaskComparison(unittest.TestCase):
    def test_voxel_scores_and_volume_in_mm(self):
        p = np.zeros((8, 8, 8), dtype=bool)
        e = np.zeros((8, 8, 8), dtype=bool)
        p[0:2, 0:2, 0:2] = 1
        e[1:3, 0:2, 0:2] = 1
        out = module.segmentation_metrics(p, e, 0.002, np.eye(4))
        self.assertEqual((out["truePositiveVoxels"],out["falsePositiveVoxels"],
                          out["falseNegativeVoxels"]), (4,4,4))
        self.assertEqual(out["dice"], 0.5)
        self.assertEqual(out["iou"], 1/3)
        self.assertEqual(out["voxelRecall"], 0.5)
        self.assertEqual(out["predictedVolumeMl"], 0.016)
        self.assertIsNotNone(out["hd95Mm"])
        self.assertIsNone(out["clinicalSensitivity"])
        self.assertIsNone(out["frocFalsePositivesPerScan"])

    def test_sparse_hd95_matches_exact_edt_when_roi_spans_many_slices(self):
        from unittest.mock import patch
        p = np.zeros((30, 30, 30), dtype=bool)
        e = np.zeros_like(p)
        p[2:5, 2:5, 2:5] = 1
        e[2:5, 2:5, 2:5] = 1
        p[25:28, 25:28, 25:28] = 1
        with patch.object(module, "HD95_MAX_CROP_VOXELS", 100):
            sparse, problem = module.estimate_hd95_mm(p, e, np.diag([.7, .7, 2.5, 1]))
        with patch.object(module, "HD95_MAX_CROP_VOXELS", 100000):
            exact, exact_problem = module.estimate_hd95_mm(p, e, np.diag([.7, .7, 2.5, 1]))
        self.assertIsNone(problem)
        self.assertIsNone(exact_problem)
        self.assertAlmostEqual(sparse, exact, places=6)
        self.assertGreater(sparse, 0)

    def test_sparse_hd95_explicit_memory_limit_is_not_fabricated_score(self):
        from unittest.mock import patch
        p = np.zeros((18, 18, 18), dtype=bool)
        e = np.zeros_like(p)
        p[1:3, 1:3, 1:3] = True
        e[15:17, 15:17, 15:17] = True
        with patch.object(module, "HD95_MAX_CROP_VOXELS", 10), \
             patch.object(module, "HD95_MAX_SURFACE_POINTS", 1):
            hd, reason = module.estimate_hd95_mm(p, e, np.eye(4))
        self.assertIsNone(hd)
        self.assertEqual(reason, "hd95_surface_point_memory_limit_exceeded")

    def test_empty_masks_are_not_perfect_diagnostic_agreement(self):
        empty = np.zeros((8,8,8), dtype=bool)
        out = module.segmentation_metrics(empty, empty, 0.002, np.eye(4))
        self.assertIsNone(out["dice"])
        self.assertIsNone(out["voxelRecall"])
        self.assertIsNone(out["hd95Mm"])
        self.assertTrue(out["bothMasksEmpty"])

    def test_full_reference_bound_evaluation_and_no_diagnosis(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=example(tmp)
            result=module.run(args)
            self.assertEqual(result["schema"], module.SCHEMA)
            self.assertAlmostEqual(result["metrics"]["dice"], 0.5)
            self.assertEqual(result["caseCount"],1)
            self.assertFalse(result["heldOutFromTrainingProven"])
            self.assertFalse(result["clinicalValidation"])
            self.assertFalse(result["sourceDicomSopBound"])
            self.assertTrue(Path(args.output).is_file())

    def test_source_or_reference_mismatch_and_rights_gate(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=example(tmp)
            args.rights_attested=False
            with self.assertRaisesRegex(ValueError,"rights"):
                module.run(args)
            args.rights_attested=True
            args.reference_sha256="f"*64
            with self.assertRaisesRegex(ValueError,"sha256"):
                module.run(args)
            args.reference_sha256=module.sha256(Path(args.reference))
            wrong=np.zeros((16,16,16),dtype=np.uint8)
            shifted=np.diag([0.7,0.7,2.5,1]); shifted[0,3]=3.0
            saved_nifti(Path(args.reference),wrong,shifted)
            args.reference_sha256=module.sha256(Path(args.reference))
            with self.assertRaisesRegex(ValueError,"grids_do_not_match"):
                module.run(args)

    def test_empty_expert_mask_can_score_false_positive_predictions(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=example(tmp)
            saved_nifti(Path(args.reference), np.zeros((16,16,16), dtype=np.uint8))
            args.reference_sha256=module.sha256(Path(args.reference))
            result=module.run(args)
            self.assertEqual(result["metrics"]["falsePositiveVoxels"], 8)
            self.assertIsNone(result["metrics"]["voxelRecall"])
            self.assertIsNone(result["metrics"]["hd95Mm"])
            self.assertFalse(result["clinicalValidation"])

    def test_genuine_mask_array_is_not_interpreted_as_probabilities(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/"mask.nii"
            value=np.ones((16,16,16),dtype=np.float32)
            saved_nifti(path,value)
            with self.assertRaisesRegex(ValueError,"masks_must_be_integer"):
                module.binary_mask(nib.load(str(path)))

if __name__=="__main__":
    unittest.main()
