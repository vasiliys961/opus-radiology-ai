#!/usr/bin/env python3
"""Technical safety contracts only. Do not claim pretrained-model inference."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "opus_evans", Path(__file__).with_name("real-head-ct-evans-offline.py"))
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class EvansResearchContracts(unittest.TestCase):
    def sample(self, index=.31):
        return {"evans_index":index, "brain_volume_ml":1400.0,
                "ventricle_volume_ml":65.0, "ventricle_brain_ratio":.046}

    def evidence(self, report=None):
        return app.interpret_vendor_report(
            report if report is not None else self.sample(),
            {"manifestSHA256":"a"*64, "verifiedInstalledAssets":[],
             "publisherHashesIndependentlyVerified":False},
            {"shape":[512,512,100],"voxelSpacingMm":[.8,.8,2.]},
            "a"*64, "research/evans@sha256:"+"b"*64,
            "CC BY 3.0","https://www.cancerimagingarchive.net/collection/lctsc/")

    def test_indicated_index_is_candidate_not_diagnosis(self):
        doc=self.evidence()
        self.assertTrue(doc["evansIndexAtLeast0_30ReviewCandidate"])
        self.assertIsNone(doc["diagnosisOfHydrocephalus"])
        self.assertFalse(doc["patientUseAllowed"])
        self.assertFalse(doc["modelOriginalPublisherCheckpointDigestIndependentlyVerified"])

    def test_lower_index_not_negative_screen(self):
        doc=self.evidence(self.sample(.29))
        self.assertFalse(doc["evansIndexAtLeast0_30ReviewCandidate"])
        self.assertFalse(doc["absenceOfHydrocephalusEstablished"])

    def test_null_or_nan_vendor_results_refused(self):
        for bad in (None, float("nan"), float("inf"), -1.):
            raw=self.sample()
            raw["evans_index"]=bad
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.evidence(raw)

    def test_inconsistent_vendor_ratio_refused(self):
        raw=self.sample()
        raw["ventricle_brain_ratio"]=.22
        with self.assertRaisesRegex(ValueError,"inconsistent"):
            self.evidence(raw)

    def test_empty_unverified_output_refused(self):
        with self.assertRaisesRegex(ValueError, "schema"):
            self.evidence({})
        with self.assertRaisesRegex(ValueError,"schema"):
            self.evidence({**self.sample(),"PatientName":"NEVER_PUBLISH"})

    def test_real_local_checkpoint_bytes_pinned_against_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            names=("nnunet/results/Task001/brain.pth","nnunet/results/Task002/ventricle.pth")
            files=[]
            for i,name in enumerate(names):
                path=root/name
                path.parent.mkdir(parents=True)
                path.write_bytes(bytes([i+1])*2048)
                files.append({"path":name,"sha256":app.file_hash(path)})
            manifest=root/"weights.json"
            manifest.write_text(json.dumps({"files":files}))
            got=app.preflight_weights(root,manifest)
            self.assertEqual(len(got["verifiedInstalledAssets"]),2)
            self.assertFalse(got["publisherHashesIndependentlyVerified"])
            (root/names[1]).write_bytes(b"changed"*400)
            with self.assertRaisesRegex(ValueError,"SHA256_mismatch"):
                app.preflight_weights(root,manifest)

    def test_symlink_checkpoint_and_parent_escape_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            orig=root/"real.pth"
            orig.write_bytes(b"1"*2048)
            link=root/"symlink.pth"
            link.symlink_to(orig)
            manifest=root/"manifest.json"
            manifest.write_text(json.dumps({"files":[
                {"path":"real.pth","sha256":app.file_hash(orig)},
                {"path":"symlink.pth","sha256":app.file_hash(orig)}]}))
            with self.assertRaisesRegex(ValueError, "missing_or_untrusted"):
                app.preflight_weights(root,manifest)
            manifest.write_text(json.dumps({"files":[
                {"path":"../out.pth","sha256":"a"*64},
                {"path":"real.pth","sha256":app.file_hash(orig)}]}))
            with self.assertRaisesRegex(ValueError,"unsafe_or_duplicate"):
                app.preflight_weights(root,manifest)

    def test_pinned_OCI_digest_required(self):
        with self.assertRaisesRegex(ValueError,"digest"):
            app.interpret_vendor_report(
                self.sample(),{},{},"a"*64,"research/evans:latest",
                "CC BY 3.0","https://example.org")


if __name__=="__main__":
    unittest.main()
