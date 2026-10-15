import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from rsna_knee_large_train import cache_key, configuration, save_atomic


class LargeTrainingContract(unittest.TestCase):
    def test_cache_key_is_versioned(self):
        args=SimpleNamespace(slices=8,series_limit=3,pixel_mode="dicom",
                             slice_order="geometry-v2",seed=42,lr=0.001,
                             series_selection="balanced")
        options=configuration(args)
        self.assertEqual(cache_key("case1",options,"backbone1"),cache_key("case1",options,"backbone1"))
        self.assertNotEqual(cache_key("case1",options,"backbone1"),cache_key("case1",options,"backbone2"))
        self.assertNotEqual(cache_key("case1",options,"backbone1"),cache_key("case2",options,"backbone1"))
        args.slices=16
        self.assertNotEqual(cache_key("case1",options,"backbone1"),cache_key("case1",configuration(args),"backbone1"))

    def test_atomic_checkpoint(self):
        class Saver:
            @staticmethod
            def save(value,path):
                Path(path).write_text(str(value))
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/"weights"/"last.pt"
            save_atomic(Saver(),{"epoch":3},path)
            self.assertIn("epoch",path.read_text())
            self.assertFalse(path.with_name(path.name+".partial").exists())

    def test_study_head(self):
        try:
            import torch
        except ImportError:
            self.skipTest("torch optional")
        from rsna_knee_large_train import forward_head
        model=SimpleNamespace(attention=torch.nn.Linear(4,1),classifier=torch.nn.Linear(4,12))
        features=torch.randn(7,4,requires_grad=True)
        logits=forward_head(model,features)
        self.assertEqual(tuple(logits.shape),(12,))
        logits.sum().backward()
        self.assertIsNotNone(features.grad)


if __name__=="__main__":
    unittest.main()
