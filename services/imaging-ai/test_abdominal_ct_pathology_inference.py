#!/usr/bin/env python3
"""Only synthetic mathematical fixtures; never count as pathology inference."""
from pathlib import Path
import json
import tempfile
import unittest
import sys
import numpy as np
import nibabel as nib

sys.path.insert(0, str(Path(__file__).resolve().parent))
from abdominal_ct_pathology_inference import run, digest, TASKS, AUTH, MIN_RAM


def save_image(path, arr, affine=None):
    matrix = np.diag([0.8, 0.8, 2.5, 1.0]) if affine is None else affine
    obj = nib.Nifti1Image(arr, matrix)
    obj.header.set_xyzt_units("mm")
    nib.save(obj, str(path))


class AbdominalPathologyContract(unittest.TestCase):
    def prepare(self, root, task):
        ct = root / "public-ct.nii"
        save_image(ct, np.full((16, 16, 9), 25, dtype=np.int16))
        checkpoint = root / "checkpoint_final.pth"
        checkpoint.write_bytes(b"NOT A PRETRAINED CHECKPOINT, SYNTHETIC CONTRACT ONLY" * 40)
        admission = root / "admission.json"
        admission.write_text(json.dumps({
            "schema": "opus-abdominal-ct-pathology-admission/v1",
            "task": task, "sourceNiftiSha256": digest(ct),
            "sourcePublicAndRightsCleared": True, "imageLicenseReviewed": True,
            "researchOnly": True, "originalHuVolumeVerified": True,
            "notPatientData": True, "modelLicenseReviewed": True,
        }))
        return (task, ct, root / "mask.nii.gz", root / "report.json",
                checkpoint, digest(checkpoint), admission, AUTH)

    def execute(self, root, task, producer):
        return run(*self.prepare(root, task), inference=producer,
                   runtime_version="2.18.0", available_ram_bytes=MIN_RAM)

    def test_two_distinct_trained_task_routes_and_native_localization(self):
        for task in TASKS:
            with self.subTest(task=task), tempfile.TemporaryDirectory() as d:
                root = Path(d)
                calls = []
                def fake(**kw):
                    calls.append(kw)
                    mask = np.zeros((16, 16, 9), dtype=np.uint8)
                    mask[1:3, 3:6, 2:5] = 1
                    if task == "kidney_cysts":
                        mask[10:12, 10:12, 6:8] = 2
                    save_image(kw["output"], mask)
                out = self.execute(root, task, fake)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0]["task"], task)
                self.assertEqual(calls[0]["device"], "cpu")
                self.assertTrue(calls[0]["ml"])
                self.assertFalse(out["execution"]["actualPretrainedInferenceClaimed"])
                self.assertFalse(out["clinicallyValidated"])
                self.assertFalse(out["negativeDiagnosisPermitted"])
                self.assertFalse(out["checkpointActuallyUsedByVendorProven"])
                self.assertEqual(len(out["proposals"]), len(TASKS[task]))
                self.assertEqual(out["proposals"][0]["modelCandidateVoxels"], 18)
                self.assertEqual(out["proposals"][0]["nativeBoundsMinXYZ"], [1,3,2])
                self.assertEqual(out["proposals"][0]["nativeBoundsMaxXYZ"], [2,5,4])
                self.assertEqual(out["proposals"][0]["nativeSliceIndicesK"], [2,3,4])
                if task == "kidney_cysts":
                    self.assertEqual(out["proposals"][1]["modelCandidateVoxels"], 8)
                self.assertTrue((root / "report.json").exists())

    def test_missing_candidates_are_not_negative_diagnosis(self):
        with tempfile.TemporaryDirectory() as d:
            def empty(**kw): save_image(kw["output"], np.zeros((16,16,9), np.uint8))
            out = self.execute(Path(d), "liver_lesions", empty)
            self.assertEqual(out["proposals"][0]["modelCandidateVoxels"], 0)
            self.assertIsNone(out["proposals"][0]["worldRasBoundsMm"])
            self.assertFalse(out["negativeDiagnosisPermitted"])

    def test_foreign_geometry_unknown_label_and_corrupt_weights_are_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            args = self.prepare(root, "kidney_cysts")
            with self.assertRaisesRegex(ValueError, "digest"):
                run(*((*args[:5], "0" * 64, *args[6:])),
                    inference=lambda **k: None, runtime_version="2.18.0",
                    available_ram_bytes=MIN_RAM)
            invalid_admission = root / "no-license.json"
            invalid_admission.write_text("{}")
            with self.assertRaisesRegex(ValueError, "authorization"):
                run(*((*args[:6], invalid_admission, args[7])),
                    inference=lambda **k: None, runtime_version="2.18.0",
                    available_ram_bytes=MIN_RAM)
            def forged(**kw):
                arr = np.zeros((16,16,9), dtype=np.uint8)
                arr[0,0,0] = 99
                save_image(kw["output"], arr)
            with self.assertRaisesRegex(ValueError, "unknown_original"):
                run(*args, inference=forged, runtime_version="2.18.0",
                    available_ram_bytes=MIN_RAM)
            self.assertFalse(args[2].exists())
            self.assertFalse(args[3].exists())
            def shifted(**kw):
                arr = np.zeros((16,16,9), dtype=np.uint8)
                m = np.diag([0.8, 0.8, 2.5, 1.0]);m[0,3] = 12
                save_image(kw["output"], arr, m)
            with self.assertRaisesRegex(ValueError, "not_in_original_CT_grid"):
                run(*args, inference=shifted, runtime_version="2.18.0",
                    available_ram_bytes=MIN_RAM)
            self.assertFalse(args[3].exists())

    def test_unavailable_resources_refuse_execution(self):
        with tempfile.TemporaryDirectory() as d:
            args = self.prepare(Path(d), "liver_lesions")
            with self.assertRaisesRegex(ValueError, "resource"):
                run(*args, inference=lambda **kw: None, runtime_version="2.18.0",
                    available_ram_bytes=100)
            self.assertFalse(args[3].exists())


if __name__ == "__main__":
    unittest.main()
