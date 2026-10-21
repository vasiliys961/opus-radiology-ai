import importlib.util
from pathlib import Path
import unittest

P=Path(__file__).with_name("real-public-msd-liver-lesions.py")
spec=importlib.util.spec_from_file_location("liver_original_pathology",P)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HepaticPathologyCandidateContract(unittest.TestCase):
    def test_only_original_task_specific_liver_lesions_not_anatomy(self):
        self.assertEqual(module.DATASET,"MedOtter/msd-liver")
        self.assertEqual(module.CASE,"liver_25.nii.gz")
        for token in ('"liver_lesions"', '"actualPretrainedInferenceCompleted"',
                      '"lesionCandidates"', "sourceNiftiWorldCentroidMm",
                      "noMalignancyEstablished"):
            self.assertIn(token,P.read_text())

    def test_expert_lesion_matching_is_one_to_one(self):
        import numpy as np
        p=np.zeros((18,18,18),dtype=np.uint8)
        g=np.zeros_like(p)
        g[2:5,2:5,2:5]=1
        g[9:12,9:12,9:12]=1
        p[2:6,2:6,2:6]=1
        p[14:17,14:17,14:17]=1
        result=module.match_expert_lesions(p,g)
        self.assertEqual(result["expertLesionCount"],2)
        self.assertEqual(result["matchedExpertLesions"],1)
        self.assertEqual(result["missedExpertLesions"],1)
        self.assertEqual(result["unmatchedPredictedLesions"],1)
        self.assertEqual(result["singleCaseLesionRecall"],0.5)
        self.assertIsNone(result["independentFROC"])

    def test_liver_lesion_native_voxel_boxes(self):
        import numpy as np
        mask=np.zeros((12,12,12),dtype=np.uint8)
        mask[2:4,4:6,8:10]=1
        matrix=np.diag([1.,2.,3.,1.])
        out=module.lesion_components(mask,matrix,minimum_voxels=4)
        self.assertEqual(len(out),1)
        self.assertEqual(out[0]["nativeVoxelBoxIJK"],[[2,3],[4,5],[8,9]])
        self.assertEqual(out[0]["candidateVoxels"],8)
        self.assertFalse(out[0]["isHepaticMalignancyConfirmed"])
        self.assertEqual(module.lesion_components(np.zeros_like(mask),matrix),[])
        mask[0,0,0]=2
        with self.assertRaisesRegex(ValueError,"invalid_native_grid"):
            module.lesion_components(mask,matrix)

if __name__=="__main__":
    unittest.main()
