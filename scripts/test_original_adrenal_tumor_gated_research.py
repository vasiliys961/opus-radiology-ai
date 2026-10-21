import importlib.util
import pathlib
import tempfile
import unittest

P=pathlib.Path(__file__).with_name("original-adrenal-tumor-gated-research.py")
S=importlib.util.spec_from_file_location("adrenal_gate",P)
M=importlib.util.module_from_spec(S)
S.loader.exec_module(M)

class AdrenalGatedResearch(unittest.TestCase):
    def test_real_label_ontology(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d)/"dataset.json"
            p.write_text('{"labels":{"background":0,"adrenal_gland":1,"tumor":2}}')
            self.assertEqual(M.check_ontology(p)["tumor"],2)
            p.write_text('{"labels":{"background":0,"adrenal_gland":1,"tumor":1}}')
            with self.assertRaises(ValueError):M.check_ontology(p)
    def test_adrenal_native_tumor_component_geometry(self):
        import numpy as np
        from types import SimpleNamespace
        roi=np.zeros((128,192,192),dtype=np.uint8)
        roi[8:12,14:18,22:26]=2
        roi[1,1,1]=1
        source=SimpleNamespace(shape=roi.shape,affine=np.diag([1.,1.,1.,1.]))
        result=M.native_adrenal_tumor_candidates(source,roi)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]["voxelCount"],64)
        self.assertEqual(result[0]["nativeRoiVoxelBoundsIJK"],[[8,11],[14,17],[22,25]])
        self.assertFalse(result[0]["adrenalMalignancyConfirmed"])

    def test_license_refusal_no_external_access(self):
        with self.assertRaises(PermissionError):
            M.run("/no-real-ct","/no-rights","/no-output",
                  expected_roi_sha="0"*64,checkpoint_sha="1"*64,
                  license_approved=False,execute=True)
    def test_source_contract_has_no_automatic_download(self):
        src=P.read_text()
        self.assertNotIn("hf_hub_download",src)
        self.assertNotIn("requests.get",src)
        self.assertIn("if not license_approved:",src)
        self.assertIn("if not sys.platform.startswith",src)

if __name__=="__main__":unittest.main()
