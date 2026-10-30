"""Safety regression tests for original kidney anatomy -> HU adapter (no fake model pass)."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location(
    "renal_calculus_native_executor", HERE / "renal_calculus_native_executor.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class KidneyAnatomyTests(unittest.TestCase):
    def test_reject_cyst_label_map(self):
        import numpy as np
        affine = np.eye(4)
        source = types.SimpleNamespace(ndim=3,shape=(16,16,16),affine=affine)
        cyst = types.SimpleNamespace(ndim=3,shape=(16,16,16),affine=affine,
                                     dataobj=np.full((16,16,16), 7, dtype=np.uint8))
        fake = types.SimpleNamespace(load=lambda path: cyst if "combined" in path else source)
        with patch.dict(sys.modules, {"nibabel":fake}):
            with self.assertRaisesRegex(ValueError,"not_total_abdomen_anatomy_labels"):
                module.separate_kidneys(Path("source.nii"),Path("combined.nii"),
                                        Path("left.nii"),Path("right.nii"))

    def test_reject_mismatched_native_geometry(self):
        import numpy as np
        source = types.SimpleNamespace(ndim=3,shape=(16,16,16),affine=np.eye(4))
        translated=np.eye(4);translated[0,3]=10
        anatomy = types.SimpleNamespace(ndim=3,shape=(16,16,16),affine=translated,
                                        dataobj=np.zeros((16,16,16),dtype=np.uint8))
        fake=types.SimpleNamespace(load=lambda path: anatomy if "combined" in path else source)
        with patch.dict(sys.modules, {"nibabel":fake}):
            with self.assertRaisesRegex(ValueError,"anatomy_and_source_affine_mismatch"):
                module.separate_kidneys(Path("source.nii"),Path("combined.nii"),
                                        Path("left.nii"),Path("right.nii"))

    def test_must_not_replace_existing_evidence(self):
        import tempfile
        with tempfile.TemporaryDirectory() as root:
            output=Path(root)/"report.json";output.write_text("existing")
            with self.assertRaisesRegex(ValueError,"new_evidence_destination_required"):
                module.execute(Path(root)/"ct.nii",output,"CC0","https://example.org/data")

if __name__=="__main__":
    unittest.main()
