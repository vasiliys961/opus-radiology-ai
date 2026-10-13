"""Audit consistency of publicly observed aggregate results; no image data or inference."""
import json
from pathlib import Path

def test_observed_spleen_dice_provenance_and_math():
    path=Path(__file__).resolve().parents[2]/"docs/verification/totalseg-msd-abdomen-real.json"
    r=json.loads(path.read_text(encoding="utf-8"))
    assert r["schema"]=="opus-totalseg-msd-abdomen-observed/v1"
    assert r["result"]=="passed_research_unvalidated"
    assert r["input"]["dimensions"]==[512,512,90]
    assert r["model"]["profile"]=="abdomen-four-organs"
    assert [x["id"] for x in r["model"]["presentLabels"]]==[1,2,3,5]
    assert r["independentAnnotationEvaluation"]["scope"]=="spleen_only"
    q=r["independentAnnotationEvaluation"]
    assert r["model"]["presentLabels"][0]["voxels"]==q["modelVoxels"]
    assert round(2*q["intersectionVoxels"]/(q["modelVoxels"]+q["groundTruthVoxels"]),6)==q["dice"]
    assert q["kidneysAndLiverDice"] is None
    assert r["clinical"]["readyForClinicalUse"] is False
    assert r["clinical"]["fullOrganCoverageVerified"] is False
    for key in ("sourceSha256","independentReferenceSha256"):
        assert len(r["input"][key])==64
    assert len(r["model"]["maskSha256"])==64
