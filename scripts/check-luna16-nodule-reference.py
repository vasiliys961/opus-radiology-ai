#!/usr/bin/env python3
"""Lightweight REAL published LUNA16 reference ingestion and MONAI weight SHA gate.

This tool NEVER runs a model and NEVER turns expert reference nodules into
AI predictions. No false sensitivity/FROC/normal result can be produced.
Public de-identified coordinate CSV only, no pixels or patient uploads.
"""
import argparse
import csv
from collections import Counter, defaultdict
import hashlib
import io
import json
import math
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[1]
REGISTRY=ROOT/"docs/pathology-model-registry.json"
MAX_CSV_BYTES=512_000
MAX_ROWS=2500
UID=re.compile(r"^[0-9]+(?:\.[0-9]+)+$")
SHA=re.compile(r"^[0-9a-f]{64}$")
EXPECTED_COLUMNS=["seriesuid","coordX","coordY","coordZ","diameter_mm"]
CHECKPOINT_SHA="b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01"
CHECKPOINT_REV="7226a40a4c3713f7d5469559b7f2fc296fd54825"


def sha256(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for part in iter(lambda:stream.read(1024*1024),b""):
            h.update(part)
    return h.hexdigest()


def registry_model(path=REGISTRY):
    contents=Path(path).read_bytes()
    if len(contents)>256*1024:
        raise ValueError("registry_too_large")
    obj=json.loads(contents)
    if obj.get("schema")!="opus-pathology-model-registry/v1" or len(obj.get("models",[]))!=1:
        raise ValueError("invalid_registry")
    model=obj["models"][0]
    if (model.get("id")!="monai-lung-nodule-ct-retinanet" or
            model.get("version")!="0.6.9" or
            model.get("artifact",{}).get("revision")!=CHECKPOINT_REV or
            model.get("artifact",{}).get("sha256")!=CHECKPOINT_SHA or
            model.get("integrationStatus")!="not_connected" or
            model.get("clinicalValidationStatus")!="not_validated" or
            model.get("allowedForPatientUse") is not False or
            model.get("milestones",{}).get("genuineInferenceOnPublicCtObserved") is not False or
            model.get("milestones",{}).get("sourceBoundCandidatesReturned") is not False):
        raise ValueError("model_provenance_or_state_mismatch")
    return model


def read_annotations(path):
    file=Path(path)
    if file.is_symlink() or not file.is_file() or not 0<file.stat().st_size<=MAX_CSV_BYTES:
        raise ValueError("unsafe_or_oversize_public_reference")
    raw=file.read_bytes()
    if b"\x00" in raw:
        raise ValueError("unsupported_public_csv_encoding")
    source_sha=hashlib.sha256(raw).hexdigest()
    try:
        text=raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("invalid_public_csv_utf8") from exc
    rows=csv.reader(io.StringIO(text),strict=True)
    if next(rows,None)!=EXPECTED_COLUMNS:
        raise ValueError("invalid_luna16_reference_columns")
    groups=defaultdict(list)
    for index,row in enumerate(rows):
        if index>=MAX_ROWS or len(row)!=5:
            raise ValueError("too_many_or_malformed_annotations")
        uid=row[0]
        if not 1<len(uid)<=96 or not UID.fullmatch(uid):
            raise ValueError("invalid_public_series_identifier")
        try:
            x,y,z,diam=(float(v) for v in row[1:])
        except ValueError as exc:
            raise ValueError("invalid_reference_coordinates") from exc
        if not all(map(math.isfinite,(x,y,z,diam))) or not (3<=diam<=150) or (
                any(abs(v)>10000 for v in (x,y,z))):
            raise ValueError("invalid_reference_coordinates")
        groups[uid].append((x,y,z,diam))
    if not groups:
        raise ValueError("empty_reference")
    return groups,source_sha


def summarize_real_references(csv_path,check_checkpoint=None,strict_official=False):
    model=registry_model()
    groups,source_sha=read_annotations(csv_path)
    nodules=sum(map(len,groups.values()))
    if strict_official and nodules!=1186:
        raise ValueError("unexpected_official_reference_count")
    sizes=Counter()
    for xs in groups.values():
        for *_,diam in xs:
            sizes["3_to_under_6_mm" if diam<6 else
                  "6_to_under_10_mm" if diam<10 else "10_mm_or_larger"]+=1
    weight_sha=None
    if check_checkpoint is not None:
        weight_path=Path(check_checkpoint)
        if weight_path.is_symlink() or not weight_path.is_file() or not (
                50*1024*1024<=weight_path.stat().st_size<=150*1024*1024):
            raise ValueError("invalid_published_checkpoint_size")
        weight_sha=sha256(weight_path)
        if weight_sha!=model["artifact"]["sha256"]:
            raise ValueError("monai_checkpoint_sha256_mismatch")
    # Numerical example is genuinely from the published annotation CSV.
    # No UID or scanner image content is printed in this summary.
    ordered=sorted(groups.items())
    example_uid,example_rows=next(((uid,rows) for uid,rows in ordered if len(rows)>=2),ordered[0])
    result={
        "schema":"opus-luna16-public-reference-admission/v1",
        "status":"public-expert-reference-read-not-detector-inference",
        "source":"LUNA16 annotations.csv, pinned public mirror",
        "annotationsSha256":source_sha,
        "referenceNodules":nodules,
        "positiveSeriesWithNoduleAnnotations":len(groups),
        "diameterGroups":dict(sorted(sizes.items())),
        "readyReferenceExample":{
            "sourceIdSha256":hashlib.sha256(example_uid.encode("ascii")).hexdigest(),
            "groundTruthOnly":True,
            "publishedNoduleCoordinatesLpsMm":[
                {"centerLpsMm":[round(x,6),round(y,6),round(z,6)],"diameterMm":round(d,6)}
                for x,y,z,d in example_rows[:3]
            ]
        },
        "modelId":model["id"],
        "modelVersion":model["version"],
        "checkpointSha256Expected":model["artifact"]["sha256"],
        "checkpointSha256Verified":weight_sha==CHECKPOINT_SHA if weight_sha else False,
        "genuineModelInferencePerformed":False,
        "modelCandidates":None,
        "detectionSensitivity":None,
        "specificity":None,
        "froc":None,
        "falsePositivesPerScan":None,
        "allScansWithAndWithoutNodulesAvailable":False,
        "independentClinicalValidation":False,
        "readyForClinicalUse":False,
    }
    return result


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--annotations",required=True,type=Path)
    ap.add_argument("--checkpoint",type=Path)
    ap.add_argument("--official-reference",action="store_true")
    args=ap.parse_args()
    result=summarize_real_references(args.annotations,args.checkpoint,args.official_reference)
    print(json.dumps(result,ensure_ascii=False,sort_keys=True))
if __name__=="__main__":
    main()
