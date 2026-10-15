import ast
import unittest
from pathlib import Path

BASE=Path(__file__).parent

class OptInSeriesSelectionTests(unittest.TestCase):
    def test_train_and_inference_track_selection(self):
        for file in ("rsna_knee_dinov2.py","rsna_knee_coatnet.py"):
            text=(BASE/file).read_text()
            ast.parse(text)
            self.assertIn('"--series-selection"',text)
            self.assertIn('"series_selection":args.series_selection',text)
            self.assertIn('series_order="provided" if args.series_selection=="balanced" else "legacy"',text)
            self.assertEqual(text.count('series_order="provided" if args.series_selection=="balanced" else "legacy"'),2)
        for file in ("rsna_knee_dinov2_predict.py","rsna_knee_coatnet_predict.py"):
            text=(BASE/file).read_text()
            ast.parse(text)
            self.assertIn('ckpt.get("series_selection","legacy")',text)
            self.assertIn('balanced_series(',text)

    def test_comparison_commands(self):
        import sys
        sys.path.insert(0,str(BASE))
        from rsna_knee_compare import training_commands
        commands=training_commands(Path("/train"),Path("/out"),Path("/split.json"),2,"balanced")
        for c in commands:
            self.assertEqual(c[c.index("--series-selection")+1],"balanced")
        with self.assertRaises(ValueError):
            training_commands(Path("/train"),Path("/out"),Path("/split.json"),2,"bad")

if __name__=="__main__":
    unittest.main()
