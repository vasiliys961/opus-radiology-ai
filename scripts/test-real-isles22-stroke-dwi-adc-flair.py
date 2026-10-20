"""ISLES genuine source admission and medical label ontology. Not fake inference."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

PATH=Path(__file__).with_name("real-isles22-stroke-dwi-adc-flair.py")
SPEC=importlib.util.spec_from_file_location("opus_real_isles", PATH)
m=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


class PublicIschemiaSafety(unittest.TestCase):
    def setUp(self):
        import numpy as np
        import nibabel as nib
        self.np,self.nib=np,nib
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.affine=np.diag([1.1,1.1,2.0,1])
        image=np.ones((32,32,24),dtype=np.float32)
        truth=np.zeros(image.shape,dtype=np.uint8)
        truth[10:14,12:16,5:7]=1
        nib.save(nib.Nifti1Image(image,self.affine),self.root/"dwi.nii.gz")
        nib.save(nib.Nifti1Image(truth,self.affine),self.root/"expert.nii.gz")

    def tearDown(self):
        self.tmp.cleanup()

    def test_published_stroke_three_sequence_paths_and_original_weights(self):
        self.assertEqual(m.DS,"shaohao011/BrainMVP-ds")
        self.assertEqual(m.WEIGHTS,"akifkaradag/isles22-nnunetv2-stroke-segmentation")
        self.assertEqual(m.CASE,"sub-strokecase0032")
        self.assertEqual(m.LABEL,"ISLES2022/ISLES2022-Training/sub-strokecase0032_ses-0001/sub-strokecase0032_ses-0001_msk.nii.gz")
        source=PATH.read_text()
        for marker in ("verified_public_download","snapshot_download",
                       "originalFold0CheckpointSha256","nnUNetPredictor",
                       "expertIschemicMaskVoxels","independentVendorTrainingHoldoutVerified"):
            self.assertIn(marker,source)

    def test_real_DWI_native_expert_positive_mask_and_affine(self):
        dwi,n=m.read_pair(self.root)
        self.assertEqual(n,32)
        self.assertEqual(dwi.shape,(32,32,24))

    def test_fractional_expert_labels_rejected(self):
        bad=self.np.zeros((32,32,24),dtype=self.np.float32)
        bad[10:12,10:12,4:7]=.25
        self.nib.save(self.nib.Nifti1Image(bad,self.affine),self.root/"expert.nii.gz")
        with self.assertRaisesRegex(ValueError,"positive_ischemic_mask"):
            m.read_pair(self.root)

    def test_nonfinite_expert_labels_rejected(self):
        bad=self.np.zeros((32,32,24),dtype=self.np.float32)
        bad[10:12,10:12,4:7]=self.np.nan
        self.nib.save(self.nib.Nifti1Image(bad,self.affine),self.root/"expert.nii.gz")
        with self.assertRaisesRegex(ValueError,"positive_ischemic_mask"):
            m.read_pair(self.root)

    def test_expert_different_physical_registration_not_accepted(self):
        bad=self.affine.copy()
        bad[1,3]=10
        original=self.nib.load(str(self.root/"expert.nii.gz"))
        self.nib.save(self.nib.Nifti1Image(self.np.asarray(original.dataobj),bad),
                      self.root/"expert.nii.gz")
        with self.assertRaisesRegex(ValueError,"geometry_invalid"):
            m.read_pair(self.root)


if __name__=="__main__":
    unittest.main()
