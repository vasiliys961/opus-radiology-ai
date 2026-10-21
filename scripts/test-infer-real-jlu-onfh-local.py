import importlib.util
import hashlib
import tempfile
import unittest
from pathlib import Path
import numpy as np
from PIL import Image

PATH=Path(__file__).with_name("infer-real-jlu-onfh-local.py")
spec=importlib.util.spec_from_file_location("onfh_local",PATH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class TrueONFHLocalInferenceContract(unittest.TestCase):
    def test_preliminary_report_positive_and_negative_not_final_diagnosis(self):
        high=mod.make_report(.9,5,"a"*64)
        low=mod.make_report(.1,5,"a"*64)
        self.assertTrue(high["researchAboveThreshold"])
        self.assertFalse(low["researchAboveThreshold"])
        self.assertIn("остеонекроз",high["preliminaryClinicalImpression"])
        self.assertIn("исключить",low["preliminaryClinicalImpression"])
        self.assertFalse(high["diagnosisConfirmed"])
        self.assertFalse(high["scoreIsCalibratedClinicalProbability"])
        self.assertEqual(high["imageOrPatientDataUploaded"],False)

    def test_real_npz_cpu_inference_identity_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            src=root/"mr"
            src.mkdir()
            for i in range(3):
                a=np.full((64,64),i*60+30,dtype=np.uint8)
                Image.fromarray(a).save(src/f"{i}.png")
            weights=root/"onfh.npz"
            n=mod.FEATURE_DIM
            np.savez_compressed(weights,coef=np.zeros((1,n),dtype=np.float32),
                intercept=np.array([1.0986123],dtype=np.float32),
                center=np.zeros(n,dtype=np.float32),
                scale=np.ones(n,dtype=np.float32),
                source_sha=np.asarray(mod.SOURCE_SHA))
            fp=hashlib.sha256(weights.read_bytes()).hexdigest()
            model=mod.load_model(weights,fp)
            features,count=mod.extract_subject(src)
            self.assertEqual(count,3)
            self.assertAlmostEqual(mod.classify(features,model),.75,places=5)
            with self.assertRaisesRegex(ValueError,"hash_mismatch"):
                mod.load_model(weights,"0"*64)
            with self.assertRaisesRegex(ValueError,"source_changed"):
                np.savez_compressed(weights,coef=np.zeros((1,n),dtype=np.float32),
                    intercept=np.zeros(1),center=np.zeros(n),
                    scale=np.ones(n),source_sha=np.asarray("a"*40))
                mod.load_model(weights,hashlib.sha256(weights.read_bytes()).hexdigest())
if __name__=="__main__":unittest.main()
