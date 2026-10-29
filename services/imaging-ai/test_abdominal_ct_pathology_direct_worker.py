"""No patient studies and no actual pretrained checkpoint loaded by these tests."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from abdominal_ct_pathology_direct_worker import installed, create_app
from abdominal_ct_pathology_inference import digest


class RealAbdominalBridgeContracts(unittest.TestCase):
    def test_model_files_must_be_original_hash_matched_and_cpu_linux(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            kidney=root/"kidney.pth"
            liver=root/"liver.pth"
            kidney.write_bytes(b"FAKE FOR TECHNICAL TESTS ONLY"*70)
            liver.write_bytes(b"SECOND FAKE FOR TECHNICAL TESTS ONLY"*70)
            pair={"kidney_cysts":(kidney,digest(kidney)),
                  "liver_lesions":(liver,digest(liver))}
            with patch("abdominal_ct_pathology_direct_worker.platform.system",return_value="Linux"),patch(
                "abdominal_ct_pathology_direct_worker.importlib.metadata.version",return_value="2.18.0"):
                verified=installed(pair)
                self.assertEqual(list(verified),["kidney_cysts","liver_lesions"])
                self.assertIsNotNone(create_app(token="x"*42,origin="http://127.0.0.1:3000",checkpoints=pair))
                invalid=dict(pair);invalid["kidney_cysts"]=(kidney,"0"*64)
                with self.assertRaisesRegex(ValueError,"checkpoint_mismatch"):
                    installed(invalid)
            with patch("abdominal_ct_pathology_direct_worker.platform.system",return_value="Darwin"),patch(
                "abdominal_ct_pathology_direct_worker.importlib.metadata.version",return_value="2.18.0"):
                with self.assertRaisesRegex(ValueError,"runtime_required"):
                    installed(pair)

    def test_no_repeat_task_and_no_untrusted_browser_origin(self):
        with tempfile.TemporaryDirectory() as d:
            model=Path(d)/"model.pth"
            model.write_bytes(b"synthetic"*160)
            pair={"kidney_cysts":(model,digest(model))}
            with patch("abdominal_ct_pathology_direct_worker.platform.system",return_value="Linux"),patch(
                "abdominal_ct_pathology_direct_worker.importlib.metadata.version",return_value="2.18.0"):
                app=create_app(token="x"*42,origin="http://127.0.0.1:3000",checkpoints=pair)
                self.assertTrue(app)
                for changes in [
                    {"token":"short"},
                    {"origin":"https://not-loopback.example"},
                    {"port":1},
                ]:
                    kwargs={"token":"x"*42,"origin":"http://127.0.0.1:3000","checkpoints":pair}
                    kwargs.update(changes)
                    with self.assertRaises(ValueError):
                        create_app(**kwargs)

if __name__=="__main__":
    unittest.main()
