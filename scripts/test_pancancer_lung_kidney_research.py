"""Offline geometry and provenance tests; placeholder weights are NEVER a pretrained model run."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import nibabel as nib
import numpy as np

spec=importlib.util.spec_from_file_location("tumor",Path(__file__).with_name("pancancer_lung_kidney_research.py"))
tumor=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tumor)


class SpecialistContracts(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory()
        self.root=Path(self.t.name)
        self.source_dir=self.root/"in"
        self.source_dir.mkdir()
        self.source=self.source_dir/"case001_0000.nii.gz"
        self.weights=self.root/"weights"
        self.weights.mkdir()
        self.output=self.root/"out"
        self.affine=np.diag([1.2, 1.2, 2., 1.])
        vox=np.zeros((32, 32, 32),dtype="int16")
        vox[:]= -1000
        vox[5:28,5:28,5:28]=100+np.random.default_rng(19).integers(-30, 30, size=(23,23,23), dtype="int16")
        self.image=vox
        self.save(self.source,vox)
        for name in ("Lung","Kidney"):
            n=105 if name=="Lung" else 102
            config=self.weights/f"Dataset{n}_{name}"/tumor.ARCH
            ck=config/"fold_0"/"checkpoint_best.pth"
            ck.parent.mkdir(parents=True)
            ck.write_bytes(b"TEST-ONLY-NOT-ORIGINAL-PRETRAINED"*900)
            (config/"dataset.json").write_text(json.dumps({
                "channel_names":{"0":"CT"},"labels":{"background":0,"tumor":1},
                "file_ending":".nii.gz"}))
            (config/"plans.json").write_text(json.dumps({"plans_name":tumor.PLANS}))
    def tearDown(self):
        self.t.cleanup()
    def save(self,p,arr):
        obj=nib.Nifti1Image(arr,self.affine)
        obj.header.set_xyzt_units("mm")
        nib.save(obj,str(p))

    def test_genuine_model_contract_source_only_readiness(self):
        for anatomy,task in [("lung",105),("kidney",102)]:
            audit=tumor.run(self.source,self.weights,self.output,anatomy)
            self.assertFalse(audit["actualOriginalTrainedForward"])
            self.assertEqual(audit["originalPretrainedModel"]["taskId"],task)
            self.assertFalse(audit["clinicalValidation"])
            self.assertFalse(audit["originalPretrainedModel"]["checkpointMatchesRealVerifiedPublisherBytes"])
            self.assertFalse(self.output.exists())
            with self.assertRaisesRegex(ValueError,"publisher pinned trained weights"):
                tumor.run(self.source,self.weights,self.output,anatomy,execute=True)

    def test_plans_and_ontology_are_strict(self):
        config=self.weights/"Dataset105_Lung"/tumor.ARCH
        (config/"dataset.json").write_text(json.dumps({
            "channel_names":{"0":"CT"},"labels":{"background":0,"tumor":2},
            "file_ending":".nii.gz"}))
        with self.assertRaisesRegex(ValueError,"ontology"):
            tumor.check_official_checkpoint(self.weights,"lung")

    def test_lung_and_kidney_orig_source_geometry_and_binary_model(self):
        pred=self.root/"pred.nii.gz"
        arr=np.zeros((32,32,32),dtype="uint8")
        arr[11:13,12:14,13:15]=1
        self.save(pred,arr)
        info=tumor.inspect_prediction(self.source,pred)
        self.assertEqual(info["candidateComponentCount"],1)
        self.assertEqual(info["nonBackgroundVoxels"],8)
        self.assertTrue(info["originalSourceGridVerified"])
        self.assertTrue(info["noExpertMaskMetrics"])
        arr[5,5,5]=2
        self.save(pred,arr)
        with self.assertRaisesRegex(ValueError,"nonbinary"):
            tumor.inspect_prediction(self.source,pred)

    def test_reject_normalized_not_hu(self):
        self.image=np.random.default_rng(49).random((32,32,32),dtype="float32")
        self.save(self.source,self.image)
        with self.assertRaisesRegex(ValueError,"original HU"):
            tumor.check_original_ct(self.source)


if __name__=="__main__":
    unittest.main()
