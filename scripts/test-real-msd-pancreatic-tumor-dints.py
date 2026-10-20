import importlib.util
from pathlib import Path
import unittest

SOURCE=Path(__file__).with_name("real-msd-pancreatic-tumor-dints.py")
spec=importlib.util.spec_from_file_location("pancreatic_dints",SOURCE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


class OriginalPancreasPathology(unittest.TestCase):
    def test_real_publisher_task_is_pancreatic_tumor_not_anatomy(self):
        self.assertEqual(mod.DATASET,"MedOtter/msd-pancreas")
        self.assertEqual(mod.MODEL,"MONAI/pancreas_ct_dints_segmentation")
        source=SOURCE.read_text()
        for item in ('"expertTumorVoxelCount"', 'native==2',
                     '"originalCtShape"', 'torch.jit.load',
                     'sliding_window_inference', '"tumorCandidateComponents"'):
            self.assertIn(item,source)

    def test_native_CT_tumor_label_components_and_world_geometry(self):
        import numpy as np
        data=np.zeros((12,12,12),dtype=np.uint8)
        data[2:4,5:7,8:10]=2
        data[9,9,9]=1
        affine=np.diag([2.,3.,4.,1.])
        affine[:3,3]=[5.,7.,11.]
        out=mod.tumor_components(data,affine,minimum_voxels=4)
        self.assertEqual(len(out),1)
        self.assertEqual(out[0]["nativeSourceVoxelBoxIJK"],[[2,3],[5,6],[8,9]])
        self.assertEqual(out[0]["nativeSourceCentroidIJK"],[2.5,5.5,8.5])
        self.assertEqual(out[0]["sourceNiftiWorldCentroidMm"],[10.,23.5,45.])
        self.assertFalse(out[0]["confirmedPancreaticCancer"])
        self.assertEqual(mod.tumor_components(np.zeros_like(data),affine),[])
        data[0,0,0]=3
        with self.assertRaisesRegex(ValueError,"native"):
            mod.tumor_components(data,affine)

if __name__=="__main__":
    unittest.main()
