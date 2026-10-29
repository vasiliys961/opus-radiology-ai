#!/usr/bin/env python3
"""Original CXR direct worker security preflight only; never makes fake inference."""
import unittest
from cxr_xrv_direct_worker import (
    MODEL_SHA, CAPABILITY, SCHEMA, safe_public_url, create_app,
)


class OriginalSixHeadWorkerContract(unittest.TestCase):
    def test_authorization_rejected_before_loading_original_checkpoint(self):
        with self.assertRaisesRegex(ValueError,"worker_token_required"):
            create_app(token="short", origin="http://127.0.0.1:3000",
                       weight_path="/no/model.pt",runner_path="/no/runner.py")
        with self.assertRaisesRegex(ValueError,"origin_required"):
            create_app(token="X"*42,origin="https://example.org",
                       weight_path="/no/model.pt",runner_path="/no/runner.py")

    def test_source_url_must_be_genuine_public_https_without_identifiers(self):
        self.assertEqual(
            safe_public_url("https://github.com/mlmed/torchxrayvision/tree/main/tests"),
            "https://github.com/mlmed/torchxrayvision/tree/main/tests")
        for bad in ("https://private.example/img?patient=42",
                    "https://username:secret@example.org/file",
                    "http://example.org/file", "https://127.0.0.1/file",
                    "https://example.com/path#raw", "file:///images/patient.png",
                    "https://example.com/\nNewLine"):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    safe_public_url(bad)

    def test_sha_and_classification_identity_are_pinned(self):
        self.assertEqual(len(MODEL_SHA),64)
        self.assertEqual(CAPABILITY,"opus-original-xrv-cxr-worker/v1")
        self.assertEqual(SCHEMA,"opus-original-xrv-cxr-six-head/v1")


if __name__=="__main__":
    unittest.main()
