#!/usr/bin/env python3
"""Contract-only numerical fixtures; NEVER claim these are real metastases."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import nibabel as nib

P=Path(__file__).with_name("real-brain-mets-t1ce-qtim.py")
spec=importlib.util.spec_from_file_location("qtim_brain_mets",P)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class TestOriginalBrainMetsContract(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir=Path(self.tmp.name)
        self.aff=np.diag([1.0,1.2,2.0,1.0])
        self.shape=(40,44,48)

    def img(self,data,affine=None):
        im=nib.Nifti1Image(data,self.aff if affine is None else affine)
        im.header.set_xyzt_units("mm")
        return im

    def original_source(self):
        data=np.zeros(self.shape,np.float32)
        data[3:36,3:40,4:43]=.72
        path=self.dir/"preprocessed.nii.gz"
        nib.save(self.img(data),str(path))
        return path

    def manifest(self,source):
        metadata={
            "schema":"opus-public-mri-t1ce-source/v1",
            "modality":"MR","sequence":"T1-CE",
            "inputNiftiSha256":m.sha(source),
            "originalT1ContrastAgentConfirmedBySourceDocumentation":True,
            "preprocessedSkullStrippedIsotropicN4RegisteredZNormalized":True,
            "publisherCheckpointTrainingOverlapIndependentlyExcluded":False,
            "originalRawDicomGeometryIndependentlyVerified":False,
            "publicLicense":"CC BY-NC 4.0",
            "publicDatasetURL":"https://example.org/public-research-only"
        }
        manifest=self.dir/"source.json"
        manifest.write_text(json.dumps(metadata))
        return manifest

    def test_source_checksum_and_explicit_protocol(self):
        source=self.original_source()
        self.assertEqual(m.parse_public_manifest(self.manifest(source),source)["sequence"],"T1-CE")
        v=m.validate_volume(source)
        self.assertEqual(v.shape,self.shape)

    def test_false_preprocessing_claim_refused(self):
        source=self.original_source()
        meta=self.manifest(source)
        x=json.loads(meta.read_text())
        x["preprocessedSkullStrippedIsotropicN4RegisteredZNormalized"]=False
        meta.write_text(json.dumps(x))
        with self.assertRaisesRegex(ValueError,"preprocessing"):
            m.parse_public_manifest(meta,source)

    def test_original_fivefold_weights_missing_refused(self):
        with self.assertRaisesRegex(ValueError,"original_vendor_model_dir"):
            m.verify_original_offline_checkpoints(self.dir/"nonexistent")

    def test_changed_official_checkpoint_refused_by_pinned_sha(self):
        folder=self.dir/"original-qtim-weights"
        (folder/"Model_0").mkdir(parents=True)
        (folder/"Model_0"/"checkpoint").write_bytes(b"pretend vendor checkpoint")
        with self.assertRaisesRegex(ValueError,"SHA256_mismatch"):
            m.verify_original_offline_checkpoints(folder)

    def test_registered_numeric_metrics_are_study_grid_bound(self):
        vol=self.img(np.ones(self.shape,np.float32))
        segmentation=np.zeros(self.shape,np.uint8)
        segmentation[10:12,8:10,4]=1
        segmentation[20:23,20:22,9]=1
        mask=self.img(segmentation)
        probability=self.img(segmentation.astype(np.float32)*.9)
        entropy=self.img(np.full(self.shape,.12,np.float32))
        truth=segmentation.copy()
        truth[10,8,4]=0
        result=m.summarize_prediction(vol,mask,probability,entropy,self.img(truth))
        self.assertEqual(result["positiveVoxelCount"],10)
        self.assertEqual(result["inferredLesionComponentCount"],2)
        self.assertEqual(result["lesions"][0]["voxels"],6)
        self.assertEqual(result["expertOverlap"]["tpVoxels"],9)
        self.assertEqual(result["expertOverlap"]["fpVoxels"],1)
        self.assertEqual(result["expertOverlap"]["fnVoxels"],0)
        self.assertEqual(result["expertOverlap"]["dice"],round(18/19,8))
        self.assertEqual(result["lesions"][0]["preprocessedVoxelBBox"],[[20,22],[20,21],[9,9]])

    def test_raw_dicom_grid_not_implied(self):
        vol=self.img(np.ones(self.shape,np.float32))
        zero=self.img(np.zeros(self.shape,np.uint8))
        pred=m.summarize_prediction(vol,zero,
            self.img(np.zeros(self.shape,np.float32)),
            self.img(np.zeros(self.shape,np.float32)))
        self.assertEqual(pred["positiveVoxelCount"],0)
        self.assertTrue(pred["sourceGridIsPreprocessedNotRawDicom"])
        self.assertIsNone(pred["expertOverlap"])

    def test_refuses_unregistered_voxel_labels(self):
        vol=self.img(np.ones(self.shape,np.float32))
        wrong=self.aff.copy()
        wrong[0,3]+=2.
        mask=self.img(np.zeros(self.shape,np.uint8),wrong)
        with self.assertRaisesRegex(ValueError,"same_preprocessed"):
            m.summarize_prediction(vol,mask,
                self.img(np.zeros(self.shape,np.float32)),
                self.img(np.zeros(self.shape,np.float32)))

    def test_rejects_invalid_probability_and_nonbinary_labels(self):
        vol=self.img(np.ones(self.shape,np.float32))
        mask=self.img(np.full(self.shape,2,np.uint8))
        zero=self.img(np.zeros(self.shape,np.float32))
        with self.assertRaisesRegex(ValueError,"binary"):
            m.summarize_prediction(vol,mask,zero,zero)
        mask=self.img(np.zeros(self.shape,np.uint8))
        bad=self.img(np.full(self.shape,1.1,np.float32))
        with self.assertRaisesRegex(ValueError,"probability"):
            m.summarize_prediction(vol,mask,bad,zero)

if __name__=="__main__":
    unittest.main()
