"""Offline RSNA knee-label completeness audit: unknown is never treated as normal."""
import argparse
import csv
import json
from pathlib import Path
from rsna_knee import LABELS,read_rows,extract_labels

def audit(rows):
    if not rows:raise ValueError("No study rows")
    uids=set()
    report={"n_studies":len(rows),"complete_gold":0,"partial":0,"unlabeled":0,
            "labels":{label:{"positive":0,"negative":0,"unknown":0} for label in LABELS}}
    for row in rows:
        uid=row.get("StudyInstanceUID","").strip()
        if not uid or uid in uids:raise ValueError("Empty or repeated study ID")
        uids.add(uid)
        y,m=extract_labels(row)
        covered=sum(bool(v) for v in m)
        if covered==len(LABELS):report["complete_gold"]+=1
        elif covered==0:report["unlabeled"]+=1
        else:report["partial"]+=1
        for name,value,known in zip(LABELS,y,m):
            label=report["labels"][name]
            label["positive" if value==1 else "negative" if known else "unknown"]+=1
    report["warning"]="Unknown labels remain unknown; neither missingness nor text mining establishes negative findings."
    return report

def write_report(csv_path,out):
    result=audit(read_rows(csv_path))
    target=Path(out);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding="utf-8")
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--train-csv",required=True)
    p.add_argument("--out",required=True)
    a=p.parse_args()
    print(json.dumps(write_report(a.train_csv,a.out),ensure_ascii=False))

if __name__=="__main__":main()
