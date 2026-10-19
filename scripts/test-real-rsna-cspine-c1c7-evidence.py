#!/usr/bin/env python3
"""Synthetic alignment and pretrained-file provenance contracts, not model inference."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import nibabel as nib
import numpy as np

SOURCE = Path(__file__).with_name("real-rsna-cspine-c1c7-evidence.py")
spec = importlib.util.spec_from_file_location("opus_cspine_evidence", SOURCE)
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class TestCervicalFractureEvidence(unittest.TestCase):
    def source(self):
        mask = np.zeros((64, 64, 64), dtype=np.uint8)
        for n in range(1, 8):
            mask[4:14, 8:18, 4+(n-1)*8:10+(n-1)*8] = app.TOTALSEG_LABEL[f"C{n}"]
        return mask, np.diag([1.5, 1.5, 2., 1.])

    def test_official_totalseg_total_label_mapping(self):
        self.assertEqual(app.TOTALSEG_LABEL, {
            "C1":50, "C2":49, "C3":48, "C4":47, "C5":46, "C6":45, "C7":44
        })
        arr, a = self.source()
        anatomy = app.c1_c7_anatomy(arr, a)
        self.assertEqual([r["vertebra"] for r in anatomy], list(app.LEVELS))
        self.assertEqual(anatomy[0]["sourceVoxelBox"], [[4,13], [8,17], [4,9]])
        self.assertEqual(anatomy[0]["anatomicalCentroidRASmm"], [12.75,18.75,13.])
        self.assertFalse(anatomy[0]["fractureLineLocalized"])

    def test_incomplete_cervical_anatomy_fails_closed(self):
        arr, a = self.source()
        arr[arr == 44] = 0
        with self.assertRaisesRegex(ValueError, "incomplete_C1_C7"):
            app.c1_c7_anatomy(arr, a)

    def test_predicted_score_and_hash_validation(self):
        with tempfile.TemporaryDirectory() as folder:
            d = Path(folder)
            weights_dir=d/"weights";weights_dir.mkdir()
            weight = weights_dir/"rsna_fold0_model_original_weights.pt"
            weight.write_bytes(b"REAL-BYTES-NOT-A-NEURAL-NETWORK"*100)
            manifest = d/"weights.json"
            manifest.write_text(json.dumps({"files":[
                {"path":weight.name, "sha256":app.digest(weight)}]}))
            provenance = app.verified_checkpoint_assets(weights_dir, manifest)
            self.assertEqual(len(provenance["assets"]),1)
            expected_ct = "a"*64
            predictions = d/"scores.json"
            def raw_scores():
                return {"schema":app.INPUT_SCHEMA,
                        "sourceCTSHA256":expected_ct,
                        "weightsManifestSHA256":provenance["manifestSHA256"],
                        "model":"rsna2022-darragh-3rd",
                        "scores":{"patient_overall":.8,**{f"C{i}":.1*i for i in range(1,8)}}}
            predictions.write_text(json.dumps(raw_scores()))
            s=app.original_scores(predictions, expected_ct, provenance)
            self.assertEqual(s["C7"], .7)
            doc=app.clinical_evidence(app.c1_c7_anatomy(*self.source()),
                s, provenance,expected_ct,"b"*64,app.digest(predictions))
            self.assertFalse(doc["modelForwardExecutedByThisAdapter"])
            self.assertFalse(doc["externalPredictionAuthenticityIndependentlyVerified"])
            self.assertFalse(doc["patientUseAllowed"])
            self.assertTrue(doc["pretrainedModelScoreIsNotFractureLineLocalization"])
            self.assertIsNone(doc["fractureDiagnosis"])
            self.assertEqual(len(doc["vertebralModelScoresAndAnatomy"]),7)
            data=raw_scores();data["scores"]["C3"]=float("nan")
            predictions.write_text(json.dumps(data))
            with self.assertRaisesRegex(ValueError, "invalid_original_model_score"):
                app.original_scores(predictions,expected_ct,provenance)
            predictions.write_text(json.dumps(raw_scores()))
            weight.write_bytes(b"tampered"*400)
            with self.assertRaisesRegex(ValueError,"SHA_mismatch"):
                app.verified_checkpoint_assets(weights_dir,manifest)

    def test_source_ct_and_anatomy_geometry_roundtrip(self):
        arr, affine=self.source()
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)
            ct=p/"ct.nii.gz";seg=p/"model_anatomy.nii.gz"
            image=nib.Nifti1Image(np.full(arr.shape,45,dtype=np.int16),affine)
            image.header.set_xyzt_units("mm")
            labels=nib.Nifti1Image(arr,affine)
            labels.header.set_xyzt_units("mm")
            nib.save(image,str(ct));nib.save(labels,str(seg))
            got,a=app.load_native(ct,seg)
            self.assertEqual(got.shape,arr.shape)
            self.assertEqual(len(app.c1_c7_anatomy(got,a)),7)
            wrong=affine.copy();wrong[0,3]+=4
            bad=nib.Nifti1Image(arr,wrong);bad.header.set_xyzt_units("mm")
            nib.save(bad,str(seg))
            with self.assertRaisesRegex(ValueError,"same_native_grid"):
                app.load_native(ct,seg)

    def test_untrusted_asset_paths_and_no_private_identifiers(self):
        with tempfile.TemporaryDirectory() as folder:
            d=Path(folder)
            weight=d/"model.pt";weight.write_bytes(b"MODEL"*700)
            manifest=d/"manifest.json"
            manifest.write_text(json.dumps({"files":[
                {"path":"../model.pt","sha256":app.digest(weight)}]}))
            with self.assertRaisesRegex(ValueError,"unsafe_checkpoint"):
                app.verified_checkpoint_assets(d,manifest)
        self.assertNotIn("StudyInstanceUID",json.dumps(app.clinical_evidence(
            app.c1_c7_anatomy(*self.source()),
            {"patient_overall":.3, **{f"C{i}":.1 for i in range(1,8)}},
            {"manifestSHA256":"a"*64,"assets":[],"publisherDigestsIndependentlyVerified":False},
            "b"*64,"c"*64,"d"*64)))
    
if __name__ == "__main__":
    unittest.main()
