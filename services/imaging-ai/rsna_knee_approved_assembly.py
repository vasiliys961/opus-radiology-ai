"""Assemble verified RSNA knee training rows without leaking gold validation.

Inputs: original competition CSV, immutable gold manifest, *independently
approved* binary weak labels. Unknown targets remain blank, never negative.
Unapproved NLP candidates are not accepted by this interface.
"""
import argparse
import csv
import json
from pathlib import Path
from rsna_knee import LABELS, read_rows, extract_labels
from rsna_knee_validation import load_partition

def assemble(root, manifest, approved, output):
    root=Path(root)
    rows=read_rows(root/"train.csv")
    train,val=load_partition(rows,manifest)
    ids={r["StudyInstanceUID"] for r in rows}
    gold_train={r["StudyInstanceUID"] for r in train}
    holdout={r["StudyInstanceUID"] for r in val}
    with Path(approved).open(newline="",encoding="utf-8-sig") as f:
        rd=csv.DictReader(f)
        if rd.fieldnames != ["StudyInstanceUID",*LABELS]:
            raise ValueError("Approved CSV must have exact 12-label schema")
        weak=list(rd)
    if len({r["StudyInstanceUID"] for r in weak})!=len(weak):
        raise ValueError("Duplicate approved study")
    if not weak:raise ValueError("No approved studies")
    assembled={}
    class_support={name:{"positive":0,"negative":0} for name in LABELS}
    def add(uid, values):
        assembled[uid]={"StudyInstanceUID":uid,**values}
        for label,v in values.items():
            if v in ("0","1"):class_support[label]["positive" if v=="1" else "negative"]+=1
    for row in train:
        y,m=extract_labels(row)
        add(row["StudyInstanceUID"],{name:(str(int(y[i])) if m[i] else "") for i,name in enumerate(LABELS)})
    weak_admitted=0
    for row in weak:
        uid=row["StudyInstanceUID"]
        if uid not in ids or uid in holdout or uid in gold_train:
            raise ValueError("Weak labels contain unknown or gold study IDs")
        values={}
        for label in LABELS:
            v=row[label].strip()
            if v not in ("","0","1"):raise ValueError("Nonbinary weak target: "+label)
            values[label]=v
        if not any(v in ("0","1") for v in values.values()):
            continue
        add(uid,values)
        weak_admitted+=1
    if weak_admitted==0:raise ValueError("No admissible weak-label cells")
    output=Path(output);output.parent.mkdir(parents=True,exist_ok=True)
    if output.resolve()==(root/"train.csv").resolve() or output.resolve()==Path(approved).resolve():
        raise ValueError("Output would overwrite source")
    with output.open("w",newline="",encoding="utf-8") as f:
        writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS]);writer.writeheader()
        for uid in sorted(assembled):writer.writerow(assembled[uid])
    summary={"gold_training_studies":len(train),"gold_validation_studies_sealed":len(val),
             "approved_weak_studies":weak_admitted,"training_studies":len(assembled),
             "class_support":class_support,
             "warning":"Input approval is a human/process attestation, not independently established by this tool. Study-level split only; patient overlap not excluded."}
    output.with_suffix(".summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    return summary

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("root","manifest","approved","output"):p.add_argument("--"+name,required=True)
    a=p.parse_args()
    print(json.dumps(assemble(a.root,a.manifest,a.approved,a.output),indent=2))
if __name__=="__main__":main()
