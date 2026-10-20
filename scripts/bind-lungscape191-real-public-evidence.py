#!/usr/bin/env python3
"""Numeric-only bind of ORIGINAL publisher forward to exact public source, no pseudo-Dice."""
import argparse
import json
from pathlib import Path
import re


def bind(source, weights, forward):
    def sha(value):
        return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value)
    if source.get("matchingSourceAndExpertNiftiGrid") is not True:
        raise ValueError("original public source and expert grid not verified")
    if source.get("trainingOverlapWithOriginalNineCoronaCasesExcluded") is not False:
        raise ValueError("must preserve possible in-training CoronaCases overlap warning")
    if source.get("expertMaskSemanticallyEquivalentToHighAttenuation") is not False:
        raise ValueError("do not equate infection segmentation with high-attenuation labels")
    if weights.get("originalAuthorPublishedMd5") != "14d9d057b79d45e3a49c54fdaf76b7fa":
        raise ValueError("unknown original publisher model archive")
    if weights.get("publisherUrl") != "https://zenodo.org/records/18860414/files/Dataset191_HighAttenuation.zip?download=1":
        raise ValueError("unrecognized publisher archive")
    if forward.get("trueOriginalTrainedModelForwardCompleted") is not True:
        raise ValueError("original pretrained inference not confirmed")
    if forward.get("status") != "research_mask_generated":
        raise ValueError("no genuine model prediction produced")
    if forward.get("verifiedNativeGrid") is not True:
        raise ValueError("native CT/prediction physical geometry not confirmed")
    if forward.get("source_sha256") != source.get("sourceSha256"):
        raise ValueError("forward source not the same original CT")
    for key, value in [
        ("source", source.get("sourceSha256")),
        ("expert", source.get("combinedExpertSha256")),
        ("archive", weights.get("observedSha256")),
        ("mask", forward.get("mask_sha256")),
    ]:
        if not sha(value):
            raise ValueError("missing or invalid " + key + " SHA256")
    folds = forward.get("weight_folds_sha256")
    if not isinstance(folds, dict) or set(folds) != set("01234") or not all(sha(v) for v in folds.values()):
        raise ValueError("publisher 5-fold original checkpoint SHA audit missing")
    if forward.get("clinicalValidation") is not False or forward.get("noIndependentClinicalValidation") is not True:
        raise ValueError("unsafe clinical validation assertion")
    return {
        "schema": "opus-lungscape191-authentic-public-ct-forward/v1",
        "publicResearchCase": source["publicResearchCase"],
        "sourceSha256": source["sourceSha256"],
        "expertReferenceSha256NotSameOntology": source["combinedExpertSha256"],
        "originalPublisherArchiveSha256": weights["observedSha256"],
        "originalInstalledFiveFoldCheckpointSha256": folds,
        "originalPredictionSha256": forward["mask_sha256"],
        "originalModelLabelMap": forward["labelMapFromInstalledModel"],
        "originalModelRegionsNotClinicalDiagnoses": forward["regionsByOriginalModelLabelNotConnectedLesions"],
        "observedNonbackgroundModelVoxels": forward["observedNonbackgroundModelVoxels"],
        "verifiedNativeGrid": True,
        "realOriginalTrainedForward": True,
        "independentValidation": False,
        "trainingOverlapExcluded": False,
        "expertMasksSemanticallyEquivalent": False,
        "expertDiceComputed": False,
        "ggoHoneycombingUIPNSIPSubtypeClassification": False,
        "clinicalUsePermitted": False,
        "sourcePixelsOrMasksIncludedInArtifact": False,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ("source-manifest", "weight-manifest", "prediction-report", "output"):
        p.add_argument("--" + key, type=Path, required=True)
    a = p.parse_args()
    report = bind(*[json.loads(getattr(a, attr).read_text()) for attr in ("source_manifest", "weight_manifest", "prediction_report")])
    if a.output.exists():
        raise ValueError("numeric artifact already exists")
    a.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"originalForwardVerified": True, "case": report["publicResearchCase"],
        "candidateVoxels": report["observedNonbackgroundModelVoxels"],
        "expertDiceComputed": False, "clinicalUsePermitted": False}))


if __name__ == "__main__":
    main()
