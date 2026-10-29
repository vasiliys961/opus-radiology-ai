"""The direct model endpoint is never a mock diagnostic service."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from effusion_direct_worker import installed_model, create_app
from effusion_inference import digest


class Task315DirectWorkerSafety(unittest.TestCase):
    def test_only_installed_pinned_original_file_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            w=Path(d)/"checkpoint_final.pth"
            w.write_bytes(b"synthetic bytes - never a pretrained model"*60)
            sha=digest(w)
            with patch("effusion_direct_worker.platform.system",return_value="Linux"),patch(
                "effusion_direct_worker.importlib.metadata.version",return_value="2.18.0"):
                self.assertEqual(installed_model(w,sha),w)
                with self.assertRaisesRegex(ValueError,"checkpoint_unverified"):
                    installed_model(w,"b"*64)
                self.assertIsNotNone(create_app(token="x"*42,
                    origin="http://127.0.0.1:3000",checkpoint=w,
                    checkpoint_sha256=sha))
            with patch("effusion_direct_worker.platform.system",return_value="Darwin"),patch(
                "effusion_direct_worker.importlib.metadata.version",return_value="2.18.0"):
                with self.assertRaisesRegex(ValueError,"runtime_unavailable"):
                    installed_model(w,sha)
    def test_reject_unsafe_worker_origin_and_session(self):
        with tempfile.TemporaryDirectory() as d:
            w=Path(d)/"checkpoint_final.pth"
            w.write_bytes(b"not a real checkpoint"*100)
            sha=digest(w)
            with patch("effusion_direct_worker.platform.system",return_value="Linux"),patch(
                "effusion_direct_worker.importlib.metadata.version",return_value="2.18.0"):
                for kwargs in [
                    {"token":"abc"},
                    {"origin":"https://unknown.com"},
                    {"port":22},
                ]:
                    args={"token":"x"*42,"origin":"http://127.0.0.1:3000",
                          "checkpoint":w,"checkpoint_sha256":sha}
                    args.update(kwargs)
                    with self.subTest(kwargs=kwargs),self.assertRaisesRegex(ValueError,"required"):
                        create_app(**args)


if __name__ == "__main__":
    unittest.main()
