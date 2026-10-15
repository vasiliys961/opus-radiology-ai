import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee_compare import training_commands
class ComparisonCommandTests(unittest.TestCase):
    def test_shared_manifest_and_distinct_outputs(self):
        cmds=training_commands(Path("/data"),Path("/work"),Path("/work/split.json"),2)
        self.assertEqual(len(cmds),2)
        self.assertNotEqual(cmds[0][-1],cmds[1][-1])
        for cmd in cmds:
            self.assertEqual(cmd[cmd.index("--manifest")+1],"/work/split.json")
            self.assertEqual(cmd[cmd.index("--epochs")+1],"2")
            self.assertIn("--train-csv",cmd)
if __name__=="__main__":unittest.main()
