"""Conservative research audit of knee MRI sequence metadata; no pixel data or report export."""
import argparse
import csv
import json
import re
from collections import Counter
from pathlib import Path
from rsna_knee import read_rows

DESCRIPTION_FIELDS=("SeriesDescription","Series_Description","ProtocolName",
                    "ScanningSequence","SequenceName")
PLANES=("Axial","Coronal","Sagittal")

def sequence_type(row):
    """Return documented pattern or 'unknown'; never infer from series UID."""
    combined=" ".join(str(row.get(key) or "") for key in DESCRIPTION_FIELDS).upper()
    text=re.sub(r"[^A-Z0-9]+"," ",combined)
    tokens=set(text.split())
    if not tokens:
        return "unknown"
    fat_suppressed=("FS" in tokens or "FATSAT" in tokens or
                    ("FAT" in tokens and ("SAT" in tokens or "SUPPRESSED" in tokens)) or
                    "SPAIR" in tokens or "STIR" in tokens or "SPIR" in tokens)
    if "STIR" in tokens:return "STIR"
    if "PD" in tokens or ("PROTON" in tokens and "DENSITY" in tokens):
        return "PD_FS" if fat_suppressed else "PD"
    if "T2" in tokens:
        return "T2_FS" if fat_suppressed else "T2"
    if "T1" in tokens:
        return "T1_FS" if fat_suppressed else "T1"
    return "unknown"

def audit_series(rows):
    if not rows:raise ValueError("No series metadata")
    by_type=Counter();by_plane=Counter();by_study={}
    for row in rows:
        uid=str(row.get("StudyInstanceUID") or "").strip()
        sid=str(row.get("SeriesInstanceUID") or "").strip()
        if not uid or not sid:raise ValueError("Missing DICOM series identifier")
        plane=row.get("Anatomical_Plane")
        sequence=sequence_type(row)
        by_type[sequence]+=1
        by_plane[plane if plane in PLANES else "unknown"]+=1
        item=by_study.setdefault(uid,{"series":set(),"planes":set(),"sequences":set()})
        item["series"].add(sid)
        if plane in PLANES:item["planes"].add(plane)
        if sequence!="unknown":item["sequences"].add(sequence)
    return {
      "n_studies":len(by_study),"n_series":len(rows),
      "known_sequence_fraction":1-by_type["unknown"]/len(rows),
      "series_by_sequence":dict(sorted(by_type.items())),
      "series_by_plane":dict(sorted(by_plane.items())),
      "studies_with_three_planes":sum(len(s["planes"])==3 for s in by_study.values()),
      "studies_with_known_sequence":sum(bool(s["sequences"]) for s in by_study.values()),
      "limitations":"Pattern matching of optional metadata only; not validated MRI pulse-sequence recognition."
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--series-csv",required=True);p.add_argument("--out",required=True)
    a=p.parse_args()
    report=audit_series(read_rows(a.series_csv))
    output=Path(a.out);output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False))
if __name__=="__main__":main()
