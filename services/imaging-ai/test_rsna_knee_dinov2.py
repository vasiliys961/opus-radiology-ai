import ast
import unittest
from pathlib import Path

class DinoContract(unittest.TestCase):
    def test_training_script_compiles(self):
        ast.parse(Path(__file__).with_name("rsna_knee_dinov2.py").read_text())
    def test_expected_core_functions(self):
        module=ast.parse(Path(__file__).with_name("rsna_knee_dinov2.py").read_text())
        names={node.name for node in module.body if isinstance(node,ast.FunctionDef)}
        self.assertTrue({"model_factory","preprocess","main"}<=names)
if __name__=="__main__":unittest.main()
