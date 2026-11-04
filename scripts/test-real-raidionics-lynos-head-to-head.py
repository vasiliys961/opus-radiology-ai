import importlib.util
import tempfile
import unittest
from pathlib import Path

path=Path(__file__).with_name("real-raidionics-lynos-head-to-head.py")
spec=importlib.util.spec_from_file_location("raidionics_lynos_comparison",path)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class TrueHeadToHeadPublicSource(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np,self.nib=np,nib
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.source=self.root/"original_ct.nii.gz"
        self.truth=self.root/"original_expert.nii.gz"
        self.prior=self.root/"pred_Lungs.nii.gz"
        self.affine=np.diag([.85,.85,1.3,1.])
        data=np.zeros((48,48,32),dtype=np.int16)
        gt=np.zeros(data.shape,dtype=np.uint8)
        gt[4:8,8:12,8:13]=1
        lungs=np.zeros(data.shape,dtype=np.float32)
        lungs[8:46,8:46,4:26]=.8
        nib.save(nib.Nifti1Image(data,self.affine),self.source)
        nib.save(nib.Nifti1Image(gt,self.affine),self.truth)
        nib.save(nib.Nifti1Image(lungs,self.affine),self.prior)

    def tearDown(self):
        self.tmp.cleanup()

    def test_original_publisher_model_and_CT_provenance_is_exact(self):
        self.assertEqual(mod.PUBLIC_CT_SHA,"d918d73688c38be7550a59e881e6a72b617f4d8f4171e99b286afb89f27ce646")
        self.assertEqual(mod.PUBLISHER_RAIDIONICS_ONNX_SHA,"922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08")
        self.assertEqual(mod.PUBLIC_NODE_EXPERT_SHA,"9f24068288b5fab6cae9f348dfbb858e2bc6cfd5e5638769c670552e6b63170b")
        source=path.read_text()
        for marker in ("bouget.run_case","raid.prepare","raid.inference","bouget.metrics",
                       "lowDiceDoesNotExcludeLymphadenopathy","expertNodeLabelsUsedForModelInference"):
            self.assertIn(marker,source)
        self.assertNotIn("OPENROUTER_API_KEY",source)

    def test_mismatch_public_CT_or_expert_hash_fails_before_staging(self):
        with self.assertRaisesRegex(ValueError,"source_CT_sha_mismatch"):
            mod.stage_same_ct_original_lung_prior(
                self.source,self.truth,self.prior,self.root/"input")

    def test_lung_prior_geometry_fails_even_on_mock_CT_hash(self):
        wrong=self.affine.copy()
        wrong[0,3]=12.
        data=self.np.ones((48,48,32),dtype=self.np.float32)
        self.nib.save(self.nib.Nifti1Image(data,wrong),self.prior)
        with self.assertRaisesRegex(ValueError,"native_geometry_not_matching"):
            mod.stage_same_ct_original_lung_prior(
                self.source,self.truth,self.prior,self.root/"input")
        self.assertFalse((self.root/"input").exists())

    def test_stage_does_not_accept_unbounded_nonbinary_probability(self):
        invalid=self.np.zeros((48,48,32),dtype=self.np.float32)
        invalid[10:12,10:12,10:12]=1.2
        self.nib.save(self.nib.Nifti1Image(invalid,self.affine),self.prior)
        # Source integrity is an independent gate and must fail even before the prior.
        with self.assertRaisesRegex(ValueError,"source_CT_sha_mismatch"):
            mod.stage_same_ct_original_lung_prior(
                self.source,self.truth,self.prior,self.root/"input")
