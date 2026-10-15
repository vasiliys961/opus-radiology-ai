import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
from rsna_knee import LABELS
from rsna_knee_coatnet_predict import validate_checkpoint

class CoAtNetPredictContract(unittest.TestCase):
    def fixture(self):
        return {"family":"coatnet-attention-mil-v1","labels":list(LABELS),
                "state_dict":{"example":"placeholder"},"architecture":"coatnet_0_rw_224",
                "slices":3,"series_limit":3}

    def test_valid_checkpoint(self):
        self.assertEqual(validate_checkpoint(self.fixture())["slices"],3)

    def test_rejects_wrong_labels(self):
        x=self.fixture();x["labels"]=list(LABELS[:-1])
        with self.assertRaisesRegex(ValueError,"schema"):
            validate_checkpoint(x)

    def test_rejects_invalid_architecture(self):
        x=self.fixture();x["architecture"]="other"
        with self.assertRaisesRegex(ValueError,"architecture"):
            validate_checkpoint(x)

    def test_rejects_invalid_slices(self):
        x=self.fixture();x["series_limit"]=0
        with self.assertRaisesRegex(ValueError,"preprocessing"):
            validate_checkpoint(x)
if __name__=="__main__":
    unittest.main()
