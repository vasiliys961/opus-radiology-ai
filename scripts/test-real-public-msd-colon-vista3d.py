#!/usr/bin/env python3
"""Small negative/positive tests: NOT evidence of lesion detection accuracy."""
import importlib.util
from pathlib import Path
import unittest

import numpy as np

source = Path(__file__).with_name("real-public-msd-colon-vista3d.py")
spec = importlib.util.spec_from_file_location("colon_vista3d", source)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TumorContract(unittest.TestCase):
    def test_tumor_label_is_not_colon_anatomy(self):
        self.assertEqual(module.LABEL, 27)
        self.assertEqual(module.MODEL, "MONAI/vista3d")

    def test_exact_voxel_confusion(self):
        expert = np.array([[[1, 1], [0, 0]]], dtype=np.uint8)
        pred = np.array([[[27, 0], [27, 0]]], dtype=np.uint8)
        self.assertEqual(module.count_confusion(pred, expert), (1, 1, 1))

    def test_no_fake_metrics_for_invalid_output(self):
        expert = np.zeros((2, 2, 2), dtype=np.uint8)
        for bad in (np.full((2, 2, 2), 1), np.full((2, 2, 2), 255)):
            with self.assertRaises(ValueError):
                module.count_confusion(bad, expert)
        with self.assertRaises(ValueError):
            module.count_confusion(np.zeros((2, 2, 3), dtype=np.uint8), expert)

    def test_no_evaluation_without_real_model(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaises((ValueError, FileNotFoundError)):
                module.evaluate(Path(tmp), Path(tmp) / "report.json")
            self.assertFalse((Path(tmp) / "report.json").exists())


if __name__ == "__main__":
    unittest.main()
