"""Private original PE server authentication/protocol gates: no fake model forwards."""
import unittest
from pe_ctpa_direct_worker import create_app,VENDOR_REV,CAPABILITY,SCHEMA


class PeCtpPublicResearchGates(unittest.TestCase):
    def test_reject_missing_worker_token_before_touching_large_model(self):
        with self.assertRaisesRegex(ValueError,"token_required"):
            create_app(token="short",origin="http://127.0.0.1:3000",
                       model_dir="/nonexistent",vendor_repo="/nonexistent",model_sha256="a"*64)
    def test_reject_public_remote_origin_before_model_load(self):
        with self.assertRaisesRegex(ValueError,"origin_required"):
            create_app(token="X"*42,origin="https://public.example",
                       model_dir="/nonexistent",vendor_repo="/nonexistent",model_sha256="a"*64)
    def test_real_model_contract_pins_correct_vendor_revision(self):
        self.assertEqual(len(VENDOR_REV),40)
        self.assertEqual(SCHEMA,"opus-original-mazurowski-ctpa-pe-source/v1")
        self.assertEqual(CAPABILITY,"opus-original-pe-ctpa-worker/v1")


if __name__=="__main__":
    unittest.main()
