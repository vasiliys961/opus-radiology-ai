"""Offline conservative report evidence, research candidate labels only.

Rules deliberately cover only unambiguous English phrases for a small subset
of knee findings. Unsupported languages and ambiguous statements abstain.
This is NOT a complete weak-label system or permission to train.
No reports, UIDs or PHI are logged.
"""
import argparse
import csv
import json
import re
from pathlib import Path
from rsna_knee import LABELS

PATTERNS={
 "ACL":(r"\b(?:complete|full.thickness)\s+(?:acl|anterior cruciate ligament)\s+tear\b",
        r"\b(?:acl|anterior cruciate ligament)\s+(?:is\s+)?intact\b"),
 "MCL":(r"\b(?:complete|full.thickness)\s+(?:mcl|medial collateral ligament)\s+tear\b",
        r"\b(?:mcl|medial collateral ligament)\s+(?:is\s+)?intact\b"),
 "Effusion":(r"\b(?:moderate|large)\s+(?:knee\s+|joint\s+)?effusion\b",
             r"\bno\s+(?:knee\s+|joint\s+)?effusion\b"),
 "Baker's":(r"\bbaker'?s\s+cyst\s+(?:is\s+)?(?:present|identified)\b",
            r"\bno\s+baker'?s\s+cyst\b"),
 "Fracture":(r"\bacute\s+(?:non.?displaced\s+|displaced\s+)?fracture\b",
             r"\bno\s+(?:acute\s+)?fracture\b"),
}
NEGATION=re.compile(r"\b(?:no|without|denies|exclude|excluded|rule\s+out|not|absence\s+of)\b",re.I)
UNCERTAINTY=re.compile(r"\b(?:possible|possibly|probable|suspect(?:ed)?|cannot\s+exclude|question(?:able)?|may\s+represent|versus|vs\.?|history\s+of|prior|old)\b",re.I)


def candidate_states(report):
    if not isinstance(report,str):
        report=""
    result={label:"not_mentioned" for label in LABELS}
    if not report.strip():
        return result
    # Do not derive negatives from silence or generic 'normal MRI'.
    sentences=re.split(r"[.;\n]+",report.lower())
    for label,(positive,negative) in PATTERNS.items():
        seen=set()
        for sentence in sentences:
            if not sentence.strip():continue
            pos=bool(re.search(positive,sentence))
            neg=bool(re.search(negative,sentence))
            if not pos and not neg:continue
            if UNCERTAINTY.search(sentence):
                seen.add("uncertain")
            elif pos and NEGATION.search(sentence) and not neg:
                seen.add("uncertain")
            elif pos and neg:
                seen.add("uncertain")
            elif pos:seen.add("positive")
            elif neg:seen.add("negative")
        if seen:
            result[label]=next(iter(seen)) if len(seen)==1 else "uncertain"
    return result


def extract(csv_path,out_path):
    source=Path(csv_path);destination=Path(out_path)
    if source.resolve()==destination.resolve():
        raise ValueError("Refusing to overwrite source CSV")
    destination.parent.mkdir(parents=True,exist_ok=True)
    counts={key:{"positive":0,"negative":0,"uncertain":0,"not_mentioned":0} for key in LABELS}
    seen=set()
    with source.open(newline="",encoding="utf-8-sig") as inp, destination.open("w",encoding="utf-8") as out:
        rows=csv.DictReader(inp)
        if not rows.fieldnames or not {"StudyInstanceUID","Report"}<=set(rows.fieldnames):
            raise ValueError("Expected StudyInstanceUID and Report columns")
        for row in rows:
            uid=row["StudyInstanceUID"]
            if not uid or uid in seen:raise ValueError("Blank or duplicate study ID")
            seen.add(uid)
            labels=candidate_states(row.get("Report",""))
            for key,state in labels.items():counts[key][state]+=1
            out.write(json.dumps({"StudyInstanceUID":uid,"labels":labels},ensure_ascii=False)+"\n")
    return {"studies":len(seen),"counts":counts,
            "warning":"High-specificity English candidates only. NEVER use as training labels without independent quality audit."}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--train-csv",required=True)
    p.add_argument("--out-jsonl",required=True)
    args=p.parse_args()
    print(json.dumps(extract(args.train_csv,args.out_jsonl),ensure_ascii=False))


if __name__=="__main__":
    main()
