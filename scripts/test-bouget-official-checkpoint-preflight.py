#!/usr/bin/env python3
"""Offline synthetic archive tests only; model weights never executed."""
import hashlib
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

MODULE = Path(__file__).with_name("bouget-official-checkpoint-preflight.py")
spec = importlib.util.spec_from_file_location("bouget_preflight", MODULE)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class OriginalArchiveGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.pth = Path(self.temp.name) / "weights.zip"
        with zipfile.ZipFile(self.pth, "w") as f:
            f.writestr("models/UNet-SW32/model.h5", b"not actual H5")
        self.expected = p.PUBLISHER_ARCHIVE_MD5

    def with_synthetic_hash(self):
        p.PUBLISHER_ARCHIVE_MD5 = p.digest_file(self.pth, "md5")
        self.addCleanup(setattr, p, "PUBLISHER_ARCHIVE_MD5", self.expected)

    def test_original_md5_is_mandatory(self):
        with self.assertRaisesRegex(ValueError, "md5_mismatch"):
            p.evaluate_checkpoint_archive(self.pth)

    def test_matching_archive_extracts_only_stable_numeric_manifest(self):
        self.with_synthetic_hash()
        report = p.evaluate_checkpoint_archive(self.pth)
        self.assertFalse(report["genuineForwardCompleted"])
        self.assertFalse(report["clinicalValidation"])
        self.assertEqual(report["modelCheckpoints"][0]["model"], "UNet-SW32")
        self.assertEqual(report["modelCheckpoints"][0]["checkpointSha256"], hashlib.sha256(b"not actual H5").hexdigest())
        self.assertNotIn("sourcePatient", str(report))

    def test_zip_path_traversal_is_blocked(self):
        with zipfile.ZipFile(self.pth, "w") as f:
            f.writestr("../malicious/model.h5", b"fake")
        self.with_synthetic_hash()
        with self.assertRaisesRegex(ValueError, "untrusted_archive_member"):
            p.evaluate_checkpoint_archive(self.pth)

    def test_executable_archive_members_not_accepted_as_model(self):
        with zipfile.ZipFile(self.pth, "w") as f:
            f.writestr("models/AGUNet/scripts.sh", b"echo dangerous")
        self.with_synthetic_hash()
        with self.assertRaisesRegex(ValueError, "no_checkpoint"):
            p.evaluate_checkpoint_archive(self.pth)

    def test_wrong_checkpoint_folder_rejected(self):
        with zipfile.ZipFile(self.pth, "w") as f:
            f.writestr("models/Unknown/model.h5", b"fake")
        self.with_synthetic_hash()
        with self.assertRaisesRegex(ValueError, "unrecognized_model"):
            p.evaluate_checkpoint_archive(self.pth)


if __name__ == "__main__":
    unittest.main()
