"""Technical source/auth and model-file contracts: NO fake pretrained inference."""
from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch
import numpy as np
import nibabel as nib
from pancreatic_tumor_original_inference import digest,model_and_source,run,AUTH,TASK


class PancreasDiNTSContracts(unittest.TestCase):
    def test_auth_denies_model_without_public_research_operator_authority(self):
        with self.assertRaisesRegex(ValueError,"authorization_required"):
            run("source.nii","model.ts","a"*64,"rights.json","result.json","")

    def test_native_CT_and_unique_torchscript_bound_to_exact_sha(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)
            scan=p/"source.nii";model=p/"original-model.ts";rights=p/"rights.json"
            nii=nib.Nifti1Image(np.zeros((9,9,9),dtype=np.float32),
                 np.diag([1.,1.,1.,1.]))
            nii.header.set_xyzt_units("mm")
            nib.save(nii,str(scan))
            model.write_bytes(b"TECHNICAL PLACEHOLDER NOT A REAL TRAINED MODEL"*30000)
            rights.write_text(json.dumps({
                "schema":"opus-abdominal-ct-pathology-admission/v1",
                "task":TASK,"sourceNiftiSha256":digest(scan),
                **{k:True for k in (
                  "sourcePublicAndRightsCleared","imageLicenseReviewed",
                  "researchOnly","originalHuVolumeVerified","notPatientData",
                  "modelLicenseReviewed")},
            }))
            image,sha=model_and_source(scan,model,digest(model),rights)
            self.assertEqual(image.shape,(9,9,9))
            self.assertEqual(sha,digest(scan))
            with self.assertRaisesRegex(ValueError,"unverified"):
                model_and_source(scan,model,"f"*64,rights)
            with self.assertRaisesRegex(ValueError,"authorization_unverified"):
                rights.write_text(json.dumps({"schema":"other"}))
                model_and_source(scan,model,digest(model),rights)
            # No forward is run: placeholder bytes are deliberately invalid TorchScript.

if __name__=="__main__":
    unittest.main()
