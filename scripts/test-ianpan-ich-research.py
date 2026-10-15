#!/usr/bin/env python3
"""Cheap synthetic-only contract tests; never load/download any medical checkpoint."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

MODULE = Path(__file__).with_name("run-ianpan-ich-research.py")
spec = importlib.util.spec_from_file_location("ianpan_contract", MODULE)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class ICHResearchTests(unittest.TestCase):
    def test_public_source_manifest_requires_hash_and_clinical_input_provenance(self):
        with tempfile.TemporaryDirectory() as base:
            p=Path(base)
            src=p/"public.nii"
            src.write_bytes(b"n" * 352)
            manifest=p/"manifest.json"
            data={
                "schema":"opus-public-head-ct-hu-evidence/v1",
                "modality":"CT","anatomy":"HEAD","contrast":"NONCONTRAST",
                "publicDataRightsReviewed":True,"deidentifiedPublicDataset":True,
                "sourceUnits":"HU_FROM_VERIFIED_DICOM_RESCALE",
                "sourceFullStudy":True,
                "consent":"PUBLIC-HEAD-NCCT-RESEARCH-OK",
                "sourceNiftiSha256":hashlib.sha256(src.read_bytes()).hexdigest()
            }
            manifest.write_text(json.dumps(data))
            self.assertEqual(mod.validate_public_manifest(src,manifest)["sourceFullStudy"],True)
            for changed in (
                {"contrast":"ENHANCED"},
                {"sourceUnits":"UNVERIFIED_STORED_INTENSITY"},
                {"deidentifiedPublicDataset":False},
                {"sourceFullStudy":False},
                {"sourceNiftiSha256":"0"*64},
            ):
                manifest.write_text(json.dumps({**data,**changed}))
                with self.assertRaises(ValueError):
                    mod.validate_public_manifest(src,manifest)
            manifest.write_text(json.dumps(data))
            symlink=p/"alias.nii"
            symlink.symlink_to(src)
            with self.assertRaisesRegex(ValueError,"unsupported"):
                mod.validate_public_manifest(symlink,manifest)

    def test_real_weight_hashes_not_bypassed_by_same_length(self):
        with tempfile.TemporaryDirectory() as base:
            with self.assertRaisesRegex(ValueError,"missing_or_tampered"):
                mod.verify_model_files(Path(base))
            first=next(iter(mod.MODEL_FILES))
            self.assertIn("inference.py", first)
            self.assertEqual(len(mod.MODEL_FILES),8)
            for digest,size in mod.MODEL_FILES.values():
                self.assertRegex(digest,r"^[a-f0-9]{64}$")
                self.assertGreater(size,1000)

    def test_slice_classification_and_model_input_heatmap_are_not_native_masks(self):
        import numpy as np
        arr=np.zeros((1,6,512,512),dtype=np.float32)
        arr[0,5,20:24,30:34]=0.9
        scores=np.zeros((1,6),dtype=np.float32)
        scores[0,5]=0.98
        series=np.array([0,0,0,0,0,0.7],dtype=np.float32)
        result=mod.numeric_predictions({
            "slice_classification":scores,
            "series_classification":series,
            "segmentation":arr,
        },1)
        self.assertEqual(len(result["candidates"]),1)
        hit=result["candidates"][0]
        self.assertEqual(hit["class"],"any")
        self.assertEqual(hit["modelInputBoundingBoxXY"],[30,20,33,23])
        self.assertEqual(hit["heatmapPositivePixelsAtPoint5"],16)
        self.assertEqual(hit["localizationFrame"],"preprocessed_512_model_input_not_source_voxel")
        self.assertEqual(hit["clinicallyConfirmed"],False)
        self.assertEqual(result["seriesRawUncalibratedScores"]["any"],0.7)
        self.assertNotIn("dice",result)
        self.assertNotIn("truePositive",hit)
        bad=np.full((1,6,512,512),1.2,dtype=np.float32)
        with self.assertRaisesRegex(ValueError,"invalid_genuine"):
            mod.numeric_predictions({
                "slice_classification":scores,
                "series_classification":series,
                "segmentation":bad,
            },1)

if __name__ == "__main__":
    unittest.main()
