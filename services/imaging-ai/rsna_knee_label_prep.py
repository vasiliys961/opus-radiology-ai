"""Offline preparation of RSNA knee weak labels from pre-reviewed JSONL.

No network calls, no PHI logging, no synthetic negative labels. Explicit labels
take precedence. Machine-derived labels are admitted only when confidently
stated and gold-set precision can be audited by class.
"""
import argparse
import csv
import json
from collections import defaultdict
from pathlib import Path

LABELS=("ACL","MCL","Medial Meniscus","Lateral Meniscus","Medial OA",
        "Lateral OA","PF OA","Effusion","Synovitis","Baker's","Contusion","Fracture")
STATES={"positive":1,"negative":0,"uncertain":None,"not_mentioned":None}

def load_jsonl(path):
    seen=set()
    with open(path,encoding="utf-8") as f:
        for lineno,line in enumerate(f,1):
            if not line.strip():continue
            row=json.loads(line)
            uid=row.get("StudyInstanceUID")
            if not isinstance(uid,str) or not uid or uid in seen:
                raise ValueError(f"Duplicate or invalid StudyInstanceUID at line {lineno}")
            seen.add(uid)
            labels=row.get("labels")
            if not isinstance(labels,dict) or set(labels)!=set(LABELS):
                raise ValueError(f"Required twelve labels missing at line {lineno}")
            for key,value in labels.items():
                if value not in STATES:
                    raise ValueError(f"Invalid state {key} at line {lineno}")
            yield uid,labels

def gold_value(s):
    s=str(s).strip()
    return int(float(s)) if s in ("0","1","0.0","1.0") else None

def prepare(csv_path,jsonl_path,out,minimum_precision=0.0):
    if not 0<=minimum_precision<=1:raise ValueError("minimum_precision must be 0..1")
    with open(csv_path,encoding="utf-8-sig",newline="") as f:
        source=list(csv.DictReader(f))
    original={r["StudyInstanceUID"]:r for r in source}
    if len(original)!=len(source):raise ValueError("Duplicate source study IDs")
    predictions=dict(load_jsonl(jsonl_path))
    if not predictions:raise ValueError("No parsed labels")
    unexpected=set(predictions)-set(original)
    if unexpected:raise ValueError("LLM labels contain non-training IDs")
    counters=defaultdict(lambda:{"tp":0,"fp":0,"tn":0,"fn":0,"unknown":0})
    # Gold is used strictly for audit; derive acceptance from gold without modifying it.
    for uid,labels in predictions.items():
        row=original[uid]
        for key in LABELS:
            truth=gold_value(row.get(key,""))
            if truth is None:continue
            pred=STATES[labels[key]]
            if pred is None:
                counters[key]["unknown"]+=1
            elif truth==1:
                counters[key]["tp" if pred==1 else "fn"]+=1
            else:
                counters[key]["fp" if pred==1 else "tn"]+=1
    precision={}
    for key,c in counters.items():
        positives=c["tp"]+c["fp"]
        precision[key]=c["tp"]/positives if positives else None
    # A class with no evaluated positive predictions cannot satisfy a precision gate.
    allowed={key for key in LABELS if minimum_precision==0 or
             (precision.get(key) is not None and precision[key]>=minimum_precision)}
    output=[]
    for row in source:
        uid=row["StudyInstanceUID"]
        outrow={"StudyInstanceUID":uid}
        for key in LABELS:
            truth=gold_value(row.get(key,""))
            pred=STATES[predictions[uid][key]] if uid in predictions and key in allowed else None
            outrow[key]=truth if truth is not None else (pred if pred is not None else "")
        output.append(outrow)
    path=Path(out);path.parent.mkdir(parents=True,exist_ok=True)
    with path.open("w",encoding="utf-8",newline="") as f:
        writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
        writer.writeheader();writer.writerows(output)
    report={"total_studies":len(source),"parsed_studies":len(predictions),
            "gold_audit":dict(counters),"positive_precision":precision,
            "admitted_classes":sorted(allowed),
            "warning":"In-sample gold audit only; use independent gold holdout before training or competition."}
    path.with_suffix(".audit.json").write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--csv",required=True)
    p.add_argument("--labels-jsonl",required=True)
    p.add_argument("--out",required=True)
    p.add_argument("--minimum-positive-precision",type=float,default=0.0)
    a=p.parse_args()
    print(json.dumps(prepare(a.csv,a.labels_jsonl,a.out,a.minimum_positive_precision)))

if __name__=="__main__":main()
