#!/usr/bin/env python3
"""Offline exact publisher model cache tests using fake bytes only, no clinical score."""
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import provision_xrv_original_model as provision


class PublisherCacheContract(unittest.TestCase):
    def test_exact_sha_download_and_second_run_without_network(self):
        content=b"technical test bytes without model weights"*50
        digest=hashlib.sha256(content).hexdigest()
        def response(request,timeout):
            self.assertEqual(request.full_url,provision.PUBLISHER)
            return io.BytesIO(content)
        with tempfile.TemporaryDirectory() as root, patch.object(provision,"SHA",digest), \
             patch.object(provision,"MIN_BYTES",1),patch.object(provision,"MAX_BYTES",100000):
            a=provision.provision(root,downloader=response)
            self.assertTrue(a["ready"])
            self.assertFalse(a["cached"])
            b=provision.provision(root,downloader=lambda *_args,**_kwargs:
                (_ for _ in ()).throw(AssertionError("network is not allowed")))
            self.assertTrue(b["cached"])
            self.assertEqual(Path(a["file"]).read_bytes(),content)

    def test_existing_bad_or_symlinked_original_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as root:
            target=Path(root)/provision.FILE
            target.write_bytes(b"not original")
            with self.assertRaisesRegex(ValueError,"SHA256"):
                provision.provision(root,downloader=lambda *_args,**_kwargs:
                    (_ for _ in ()).throw(AssertionError("unexpected download")))


if __name__=="__main__":
    unittest.main()
