#!/usr/bin/env python3
"""No medical model in tests: assert safe task315 launch and source geometry."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

import nibabel as nib
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parent))
from effusion_inference import run,AUTH,MIN_FREE_RAM_BYTES,digest

def saved(path,data):
    affine=np.diag([0.9,0.9,3.0,1.0])
    image=nib.Nifti1Image(data,affine)
    image.header.set_xyzt_units("mm")
    nib.save(image,str(path))
    return path

class RealEffusionTaskContract(unittest.TestCase):
    def fixture(self,root):
        source=saved(root/"public-chest.nii",np.full((16,16,9),-780,dtype=np.int16))
        checkpoint=root/"checkpoint_final.pth"
        checkpoint.write_bytes(b"test synthetic checkpoint, NOT pretrained weights"*40)
        sha=digest(checkpoint)
        admission=root/"source-admission.json"
        admission.write_text(json.dumps({
            "schema":"opus-public-ct-task315-admission/v1",
            "sourceSha256":digest(source),"modality":"CT",
            "pixelIntensity":"verified-original-HU",
            "fullAcquisitionCoverageVerified":True,
            "publicOrRightsClearedResearchData":True,
            "notRealPatientData":True,
            "originalImageLicenseReviewed":True
        }))
        return source,checkpoint,sha,admission
    def options(self,root):
        s,w,sha,ad=self.fixture(root)
        return (s,root/"model-mask.nii.gz",root/"medical-evidence.json",w,sha,ad,AUTH)
    def run_mock(self,root,writer):
        return run(*self.options(root),inference=writer,
            available_ram_bytes=MIN_FREE_RAM_BYTES,runtime_version="2.18.0")
    def test_launch_original_task315_not_anatomy_total(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            def fake(**kwargs):
                self.assertEqual(kwargs["task"],"pleural_pericard_effusion")
                self.assertEqual(kwargs["device"],"cpu")
                self.assertTrue(kwargs["ml"])
                labels=np.zeros((16,16,9),dtype=np.uint8)
                labels[1:6,1:7,2:6]=1
                labels[2:4,2:5,3:5]=2
                labels[10:12,10:12,5]=3
                saved(kwargs["output"],labels)
            result=self.run_mock(root,fake)
            self.assertEqual(result["runMode"],"technical-fixture")
            self.assertFalse(result["activeWeightsCryptographicallyProven"])
            self.assertFalse(result["actualPretrainedInferenceClaimed"])
            self.assertEqual([x["modelPositiveNativeVoxelCount"] for x in result["evidence"]["fluidCandidates"]],[12,4])
            self.assertFalse(result["negativeDiagnosisPermitted"])
            self.assertTrue((root/"medical-evidence.json").is_file())
    def test_empty_mask_is_not_negative(self):
        with tempfile.TemporaryDirectory() as d:
            def fake(**kw):saved(kw["output"],np.zeros((16,16,9),dtype=np.uint8))
            result=self.run_mock(Path(d),fake)
            self.assertEqual([x["modelPositiveNativeVoxelCount"] for x in result["evidence"]["fluidCandidates"]],[0,0])
            self.assertFalse(result["negativeDiagnosisPermitted"])
    def test_fail_closed_when_bad_source_or_weights(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);args=self.options(root)
            wrong=root/"wrong.json";wrong.write_text("{}")
            with self.assertRaisesRegex(ValueError,"not_authorized"):
                run(*((*args[:5],wrong,args[6])),inference=lambda **kw:None,
                    available_ram_bytes=MIN_FREE_RAM_BYTES,runtime_version="2.18.0")
            with self.assertRaisesRegex(ValueError,"checkpoint_digest"):
                run(*((*args[:4],"f"*64,*args[5:])),inference=lambda **kw:None,
                    available_ram_bytes=MIN_FREE_RAM_BYTES,runtime_version="2.18.0")
            with self.assertRaisesRegex(ValueError,"safe_ram"):
                run(*args,inference=lambda **kw:None,
                    available_ram_bytes=100,runtime_version="2.18.0")
    def test_failed_model_output_is_deleted(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);args=self.options(root)
            def bad(**kw):
                saved(kw["output"],np.full((16,16,9),4,dtype=np.uint8))
            with self.assertRaisesRegex(ValueError,"unexpected_model_label"):
                run(*args,inference=bad,available_ram_bytes=MIN_FREE_RAM_BYTES,
                    runtime_version="2.18.0")
            self.assertFalse(args[1].exists())
            self.assertFalse(args[2].exists())

if __name__=="__main__":unittest.main()
