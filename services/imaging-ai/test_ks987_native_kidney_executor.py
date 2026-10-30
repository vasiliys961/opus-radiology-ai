import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from ks987_native_kidney_executor import execute

class Ks987Native(unittest.TestCase):
    def test_rejects_non_native_and_oversmall_source(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);models=root/"models";models.mkdir()
            with self.assertRaisesRegex(ValueError,"original_native_nii_required"):
                execute(root/"missing.nii.gz",models)
            path=root/"case.nii";path.write_bytes(b"not a CT")
            with self.assertRaisesRegex(ValueError,"unbounded_native_source"):
                execute(path,models)
    def test_cannot_claim_forward_from_non_original_model(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);source=root/"original.nii";source.write_bytes(b"0"*2048)
            models=root/"models";models.mkdir()
            class Fake:
                @staticmethod
                def run(*a,**kw):
                    return {"schema":"opus-original-ks987-pancancer-specific-ct/v1",
                            "actualOriginalTrainedForward":False}
            with patch("ks987_native_kidney_executor.original",return_value=Fake):
                with self.assertRaisesRegex(ValueError,"authentic_native_ks987_forward_not_proven"):
                    execute(source,models)

if __name__=="__main__":unittest.main()
