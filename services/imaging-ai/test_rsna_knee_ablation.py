import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee_ablation import EXPERIMENTS,build_commands

class AblationTests(unittest.TestCase):
    def test_one_factor_changes_at_a_time(self):
        self.assertEqual(len(EXPERIMENTS),4)
        baseline=EXPERIMENTS[0][1:]
        for candidate in EXPERIMENTS[1:]:
            self.assertEqual(sum(a!=b for a,b in zip(baseline,candidate[1:])),1)
    def test_shared_split_and_separate_weights(self):
        cmds=build_commands(Path("/data"),Path("/work"),Path("/work/shared_split.json"),2,42)
        outputs=set()
        for _,cmd,out in cmds:
            self.assertEqual(cmd[cmd.index("--manifest")+1],"/work/shared_split.json")
            self.assertEqual(cmd[cmd.index("--seed")+1],"42")
            self.assertNotIn(out,outputs)
            outputs.add(out)
        self.assertEqual(len(outputs),4)
if __name__=="__main__":unittest.main()
