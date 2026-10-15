"""Strict study-level average of two matching 12-label prediction CSVs."""
import argparse
import csv
import math
from pathlib import Path
from rsna_knee import LABELS

FIELDS=("StudyInstanceUID",*LABELS)
def read_prediction(path):
    with open(path,encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        if reader.fieldnames!=list(FIELDS):raise ValueError("CSV header or label order mismatch")
        rows={}
        for row in reader:
            uid=row["StudyInstanceUID"]
            if not uid or uid in rows:raise ValueError("Empty or duplicate study ID")
            values=[]
            for label in LABELS:
                value=float(row[label])
                if not math.isfinite(value) or not 0<=value<=1:raise ValueError("Invalid probability")
                values.append(value)
            rows[uid]=values
        if not rows:raise ValueError("Empty predictions")
    return rows
def merge_predictions(left,right,output,weight=0.5):
    if not 0<=weight<=1:raise ValueError("weight must be between 0 and 1")
    a=read_prediction(left);b=read_prediction(right)
    if set(a)!=set(b):raise ValueError("Study IDs differ between models")
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    with output.open("w",newline="",encoding="utf-8") as f:
        w=csv.writer(f);w.writerow(FIELDS)
        for uid in sorted(a):
            w.writerow([uid,*[weight*x+(1-weight)*y for x,y in zip(a[uid],b[uid])]])
    return len(a)
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dinov2",required=True);p.add_argument("--coatnet",required=True)
    p.add_argument("--out",required=True);p.add_argument("--dinov2-weight",type=float,default=0.5)
    args=p.parse_args()
    print("Studies:",merge_predictions(args.dinov2,args.coatnet,args.out,args.dinov2_weight))
if __name__=="__main__":main()
