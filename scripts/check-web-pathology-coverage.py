#!/usr/bin/env python3
"""Local UI coverage evidence must exactly equal canonical source of truth."""
import json
from pathlib import Path
source=Path("docs/clinical-detector-coverage.json")
web=Path("web/public/examples/clinical-pathology-coverage.json")
a=json.loads(source.read_text())
b=json.loads(web.read_text())
assert a == b, "Web pathology evidence changed/stale vs canonical registry"
assert a["schema"]=="opus-clinically-prioritized-detector-coverage/v1"
assert len(a["entries"])>=33
identifiers={x["id"] for x in a["entries"]}
assert len(identifiers)==len(a["entries"])
states={"real_case_measured","real_trial_running","real_checkpoint_candidate","license_blocked","weights_unverified"}
for entry in a["entries"]:
    assert entry["status"] in states
    assert entry["source"].startswith("https://")
    assert "pathology" in entry and "anatomy" in entry and "reference" in entry
assert all(x["status"]!="patient_ready" for x in a["entries"])
print("PASS: browser evidence is exact local mirror; no unsupported patient-ready status",
      len(a["entries"]))
