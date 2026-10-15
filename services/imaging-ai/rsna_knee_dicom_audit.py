"""Offline knee MRI DICOM input quality audit.

No images, patient data, or StudyInstanceUID values are written to the report.
"""
import argparse
import json
from collections import Counter
from pathlib import Path
from rsna_knee import read_rows, PLANES

def inspect_series(root,rows,limit=None):
    """Aggregate expected series coverage and DICOM header defects, without pixel decoding."""
    import pydicom
    if limit is not None and limit<1:
        raise ValueError("limit must be positive")
    stats=Counter()
    planes={}
    seen=set()
    for row in rows[:limit] if limit is not None else rows:
        uid=str(row["StudyInstanceUID"])
        sid=str(row["SeriesInstanceUID"])
        if not uid or not sid or any(part in value for value in (uid,sid) for part in ("..","/","\\\\") ):
            raise ValueError("Unsafe DICOM identifier")
        if (uid,sid) in seen:
            stats["duplicate_metadata_rows"]+=1
            continue
        seen.add((uid,sid))
        plane=row.get("Anatomical_Plane","")
        if plane in PLANES:
            planes.setdefault(uid,set()).add(plane)
        else:
            stats["unknown_plane_series"]+=1
        folder=Path(root)/uid/sid
        paths=sorted(folder.glob("*.dcm")) if folder.is_dir() else []
        stats["series_total"]+=1
        if not paths:
            stats["series_no_dicom_files"]+=1
            continue
        stats["dicom_files_total"]+=len(paths)
        numbers=[]
        positions=[]
        read_fail=0
        for file in paths:
            try:
                ds=pydicom.dcmread(str(file),stop_before_pixels=True)
                number=ds.get("InstanceNumber")
                if number is not None:
                    numbers.append(int(number))
                location=ds.get("ImagePositionPatient")
                if location is not None and len(location)==3:
                    positions.append(tuple(round(float(x),4) for x in location))
                if ds.get("Rows",0)==0 or ds.get("Columns",0)==0:
                    stats["headers_missing_matrix"]+=1
            except (OSError,ValueError,TypeError,AttributeError,pydicom.errors.InvalidDicomError):
                read_fail+=1
        stats["headers_read_failed"]+=read_fail
        if numbers and len(numbers)==len(paths) and len(set(numbers))!=len(numbers):
            stats["series_repeated_instance_number"]+=1
        if numbers and len(numbers)!=len(paths):
            stats["series_partial_instance_number"]+=1
        if positions and len(positions)==len(paths) and len(set(positions))!=len(positions):
            stats["series_repeated_position"]+=1
        if len(paths)<3:
            stats["series_fewer_than_three_files"]+=1
    return {
        "series_total":stats["series_total"],
        "studies_total":len({uid for uid,_ in seen}),
        "studies_three_planes":sum(len(x)==3 for x in planes.values()),
        "dicom_files_total":stats["dicom_files_total"],
        "findings":{k:stats[k] for k in (
            "duplicate_metadata_rows","unknown_plane_series","series_no_dicom_files",
            "series_fewer_than_three_files","headers_read_failed","headers_missing_matrix",
            "series_repeated_instance_number","series_partial_instance_number",
            "series_repeated_position")},
        "limitations":"Header-only QC. Does not validate pixel quality, diagnostic coverage or anatomy."
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dicom-root",required=True)
    p.add_argument("--series-csv",required=True)
    p.add_argument("--out",required=True)
    p.add_argument("--limit",type=int,default=None)
    args=p.parse_args()
    result=inspect_series(args.dicom_root,read_rows(args.series_csv),args.limit)
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(result,ensure_ascii=False))
if __name__=="__main__":main()
