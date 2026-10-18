#!/usr/bin/env python3
"""Validate source-backed research detector backlog; NOT a diagnostic test."""
import json
from pathlib import Path
registry=json.loads(Path("docs/clinical-detector-coverage.json").read_text())
assert registry.get("schema")=="opus-clinically-prioritized-detector-coverage/v1"
items=registry.get("entries")
assert isinstance(items,list) and len(items)>=30
valid={"real_case_measured","real_trial_running","real_checkpoint_candidate","license_blocked","weights_unverified"}
ids=set()
for item in items:
    required=("id","modality","anatomy","pathology","status","weights",
              "source","reference","restriction","priority","next")
    assert all(isinstance(item.get(k),str) and item[k].strip() for k in required if k!="priority")
    assert isinstance(item.get("priority"),int) and 1<=item["priority"]<=4
    assert item["status"] in valid
    assert item["id"] not in ids
    ids.add(item["id"])
    assert item["source"].startswith("https://")
    assert item["status"]!="license_blocked" or "license" in item["restriction"].lower()
assert any(item["status"]=="real_case_measured" for item in items)
assert any(item["status"]=="weights_unverified" for item in items)
print("Clinical pathology candidate inventory valid, unique entries:",len(items))
