import unittest
from types import SimpleNamespace
from rsna_knee_large_train import configuration
from rsna_knee_finding_predict import validate
from rsna_knee import LABELS


class FindingPipelineContract(unittest.TestCase):
    def test_old_training_configuration_unchanged(self):
        args=SimpleNamespace(slices=8,series_limit=3,pixel_mode="dicom",
          slice_order="geometry-v2",seed=42,lr=.001,series_selection="balanced")
        old=configuration(args)
        self.assertNotIn("head",old)
        args.head="finding-v2"
        self.assertEqual(configuration(args)["head"],"finding-v2")

    def test_inference_rejects_old_weights(self):
        with self.assertRaises(ValueError):
            validate({"model":"dinov2-small-mil-v1"})

    def test_validation_contract(self):
        ckpt={"model":"dinov2-small-finding-mil-v2","head_family":"finding-v2",
              "labels":list(LABELS),"state_dict":{"x":1},"head_state_dict":{"x":1},
              "slices":8,"series_limit":3,"series_selection":"balanced",
              "slice_order":"geometry-v2","pixel_mode":"dicom"}
        self.assertIs(validate(ckpt),ckpt)
        ckpt["pixel_mode"]="bogus"
        with self.assertRaises(ValueError):
            validate(ckpt)


if __name__=="__main__":unittest.main()
