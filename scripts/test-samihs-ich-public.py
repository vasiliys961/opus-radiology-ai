#!/usr/bin/env python3
"""Lightweight contract checks only; does not run or fake a medical model."""
import importlib.util
from pathlib import Path
import tempfile
import types
import unittest


SCRIPT = Path(__file__).with_name("run-samihs-ich-public.py")
spec = importlib.util.spec_from_file_location("samihs_public", SCRIPT)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class SamihsPublicContract(unittest.TestCase):
    def test_sha_validation_and_exact_bytes(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / "public-fixture.bin"
            file.write_bytes(b"synthetic-only-not-medical-data")
            digest = runner.sha256_file(file)
            self.assertEqual(len(digest), 64)
            self.assertEqual(runner.valid_sha(digest, "fixture"), digest)
            with self.assertRaises(ValueError):
                runner.valid_sha("bad", "fixture")
            self.assertEqual(runner.regular_file(file), file.resolve())
            with self.assertRaises(ValueError):
                runner.regular_file(file, max_bytes=1)

    def test_mandatory_consent_and_no_m1_execution(self):
        args = types.SimpleNamespace(
            public_research_authorization="missing", device="cuda:0",
            slice_axis=2, batch_size=1, threshold=0.5,
        )
        with self.assertRaisesRegex(ValueError, "authorization"):
            runner.execute(args)
        args.public_research_authorization = "PUBLIC-ICH-RESEARCH-ONLY"
        args.device = "cpu"
        with self.assertRaisesRegex(ValueError, "no_mac_m1"):
            runner.execute(args)

    def test_bounds_fail_before_loading_model_or_source(self):
        args = types.SimpleNamespace(
            public_research_authorization="PUBLIC-ICH-RESEARCH-ONLY",
            device="cuda:0", slice_axis=9, batch_size=1, threshold=0.5,
        )
        with self.assertRaisesRegex(ValueError, "slice_axis"):
            runner.execute(args)
        args.slice_axis = 2
        args.threshold = -1
        with self.assertRaisesRegex(ValueError, "threshold"):
            runner.execute(args)


if __name__ == "__main__":
    unittest.main()
