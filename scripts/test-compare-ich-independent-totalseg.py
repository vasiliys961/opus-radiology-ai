#!/usr/bin/env python3
"""Fast contracts only; artificial CT pixels are NOT a clinical test."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import numpy as np
import nibabel as nib

p=Path(__file__).with_name("compare-ich-independent-totalseg.py")
spec=importlib.util.spec_from_file_location("opus_second_ich_research",p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class IndependentPretrainedCrossCheck(unittest.TestCase):
    def test_second_mask_is_consistency_only_not_ground_truth(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);shape=(16,16,8)
            affine=np.diag([.8,.8,3.,1.])
            source=nib.Nifti1Image(np.zeros(shape,np.int16),affine)
            source.header.set_xyzt_units("mm");source.set_sform(affine,code=1)
            original=root/"ct.nii";nib.save(source,original)
            mask=np.zeros(shape,dtype=np.uint8);mask[2:4,3:5,4]=1;mask[10,12,6]=1
            nii=nib.Nifti1Image(mask,affine)
            nii.header.set_xyzt_units("mm");nii.set_sform(affine,code=1)
            maskpath=root/"second.nii.gz";nib.save(nii,maskpath)
            old=m.SRC_SHA
            m.SRC_SHA=m.sha256(original)
            try:
                candidates=[]
                for z in range(1,8):
                    candidates.append({
                     "class":"intraparenchymal","sourceVoxelProjection":{
                      "boundingBoxNativeNiftiXYZ":[2,3,z,5,6,z],
                      "independentlyClinicallyVerified":False,"expertMaskCompared":False},
                    })
                report={"schema":m.MODEL_REPORT,
                   "readyForClinicalUse":False,
                   "source":{"niftiSha256":m.SRC_SHA,
                     "sourceDimensionsXYZ":list(shape),
                     "referenceLabelsOnlyPerihematomalEdema":True,
                     "sourceOriginalDicomHURescaleIndependentlyVerified":False},
                   "externalExpertHemorrhageLocalizationComparisonPerformed":False,
                   "candidates":candidates}
                src=root/"original-report.json";src.write_text(json.dumps(report))
                result=m.compare(original,maskpath,src,"f"*64)
                self.assertEqual(result["secondModelMaskPositiveVoxels"],5)
                self.assertEqual(result["secondModelMaskVoxelsInsideFirstModelBoundingBoxUnion"],4)
                self.assertAlmostEqual(result["secondModelMaskShareWithinFirstModelBounds"],.8)
                self.assertEqual(result["secondModelSourceSliceIndices"],[4,6])
                self.assertIsNone(result["segmentationDiceAgainstExpertMask"])
                self.assertIsNone(result["clinicalLesionTruePositive"])
                self.assertFalse(result["clinicalValidation"])
                report["source"]["referenceLabelsOnlyPerihematomalEdema"]=False
                src.write_text(json.dumps(report))
                with self.assertRaisesRegex(ValueError,"not_original"):
                    m.compare(original,maskpath,src,"f"*64)
            finally:m.SRC_SHA=old
if __name__=="__main__":unittest.main()
