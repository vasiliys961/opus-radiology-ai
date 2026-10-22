#!/usr/bin/env python3
"""Small numeric contract checks; never presented as an original model inference."""
import importlib.util
from pathlib import Path
import unittest

P = Path(__file__).with_name("bind-lungscape191-real-public-evidence.py")
spec = importlib.util.spec_from_file_location("lungscape_numeric_bind", P)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
bind = module.bind


def fixtures():
    source = {
        "matchingSourceAndExpertNiftiGrid": True,
        "trainingOverlapWithOriginalNineCoronaCasesExcluded": False,
        "expertMaskSemanticallyEquivalentToHighAttenuation": False,
        "sourceSha256": "a" * 64, "combinedExpertSha256": "b" * 64,
        "publicResearchCase": "coronacases_003",
    }
    weights = {
        "originalAuthorPublishedMd5": "14d9d057b79d45e3a49c54fdaf76b7fa",
        "publisherUrl": "https://zenodo.org/records/18860414/files/Dataset191_HighAttenuation.zip?download=1",
        "observedSha256": "c" * 64,
    }
    forward = {
        "trueOriginalTrainedModelForwardCompleted": True,
        "status": "research_mask_generated",
        "verifiedNativeGrid": True,
        "source_sha256": source["sourceSha256"],
        "mask_sha256": "d" * 64,
        "weight_folds_sha256": {str(i): (str(i) * 64) for i in range(5)},
        "inferenceActualFolds": ["0"],
        "publisherFiveFoldEnsembleUsed": False,
        "reducedCpuProtocolNotPublisherFiveFold": True,
        "clinicalValidation": False,
        "noIndependentClinicalValidation": True,
        "labelMapFromInstalledModel": {"0": "background", "1": "high_attenuation"},
        "regionsByOriginalModelLabelNotConnectedLesions": [],
        "observedNonbackgroundModelVoxels": 0,
    }
    return source, weights, forward


class NumericEvidenceGuard(unittest.TestCase):
    def test_real_single_fold_stays_research_only(self):
        out = bind(*fixtures())
        self.assertEqual(out["inferenceActualFolds"], ["0"])
        self.assertFalse(out["publisherFiveFoldEnsembleUsed"])
        self.assertFalse(out["expertDiceComputed"])
        self.assertFalse(out["clinicalUsePermitted"])

    def test_false_fivefold_promotion_rejected(self):
        a, b, c = fixtures()
        c["publisherFiveFoldEnsembleUsed"] = True
        with self.assertRaisesRegex(ValueError, "ensemble"):
            bind(a, b, c)

    def test_false_low_memory_provenance_rejected(self):
        a, b, c = fixtures()
        c["reducedCpuProtocolNotPublisherFiveFold"] = False
        with self.assertRaisesRegex(ValueError, "protocol"):
            bind(a, b, c)

    def test_mismatched_source_rejected(self):
        a, b, c = fixtures()
        c["source_sha256"] = "f" * 64
        with self.assertRaisesRegex(ValueError, "same original CT"):
            bind(a, b, c)

    def test_original_fivefold_is_distinct(self):
        a, b, c = fixtures()
        c["inferenceActualFolds"] = list("01234")
        c["publisherFiveFoldEnsembleUsed"] = True
        c["reducedCpuProtocolNotPublisherFiveFold"] = False
        out = bind(a, b, c)
        self.assertTrue(out["publisherFiveFoldEnsembleUsed"])


if __name__ == "__main__":
    unittest.main()
