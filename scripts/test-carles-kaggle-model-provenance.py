import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("carles-kaggle-model-provenance.py")
spec = importlib.util.spec_from_file_location("carles_provenance", SCRIPT)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class SourceContract(unittest.TestCase):
    def test_original_ct_publisher_and_not_pet(self):
        payload = json.dumps({"licenseName": "CC BY-NC 4.0",
                              "modelInstances": [{"framework": "pyTorch",
                                                  "instanceSlug": "default",
                                                  "currentVersionNumber": 1}]}).encode()
        report = mod.parse_metadata(payload)
        self.assertEqual(report["expectedNnUNetTask"], "Task998_LungCTSegmentation")
        self.assertEqual(report["petTaskExcluded"], "Task999_LungPETSegmentation")
        self.assertFalse(report["originalWeightsVerified"])
        self.assertFalse(report["inferenceCompleted"])
        self.assertEqual(report["variations"][0]["variant"], "default")

    def test_missing_variation_never_guessed_and_invalid_payload_refused(self):
        self.assertEqual(mod.parse_metadata(b'{"licenseName":null}')["variations"], [])
        with self.assertRaisesRegex(ValueError, "invalid_kaggle_model_metadata"):
            mod.parse_metadata(b"[]")
        with self.assertRaisesRegex(ValueError, "oversized"):
            mod.parse_metadata(b"x" * (mod.MAX_METADATA + 1))


if __name__ == "__main__":
    unittest.main()
