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

# Conservative English candidates, NOT a replacement for competition ontology.
# Explicit "tear" and "osteoarthritis" are accepted; generic degeneration is not.
STRUCTURE = {
    "ACL": r"(?:acl|anterior cruciate ligament)",
    "MCL": r"(?:mcl|medial collateral ligament)",
    "Medial Meniscus": r"(?:medial meniscus|medial meniscal)",
    "Lateral Meniscus": r"(?:lateral meniscus|lateral meniscal)",
}
POSITIVE = {
    "ACL": rf"(?:\b{STRUCTURE['ACL']}\b.{{0,45}}\b(?:tear|rupture|torn)\b|\b(?:tear|rupture)\b.{{0,30}}\b{STRUCTURE['ACL']}\b)",
    "MCL": rf"(?:\b{STRUCTURE['MCL']}\b.{{0,45}}\b(?:tear|rupture|torn)\b|\b(?:tear|rupture)\b.{{0,30}}\b{STRUCTURE['MCL']}\b)",
    "Medial Meniscus": rf"(?:\b{STRUCTURE['Medial Meniscus']}\b.{{0,45}}\b(?:tear|torn)\b|\b(?:tear|torn)\b.{{0,30}}\b{STRUCTURE['Medial Meniscus']}\b)",
    "Lateral Meniscus": rf"(?:\b{STRUCTURE['Lateral Meniscus']}\b.{{0,45}}\b(?:tear|torn)\b|\b(?:tear|torn)\b.{{0,30}}\b{STRUCTURE['Lateral Meniscus']}\b)",
    "Medial OA": r"\bmedial (?:compartment|tibiofemoral)\b.{0,45}\b(?:osteoarthritis|osteoarthrosis)\b|\b(?:osteoarthritis|osteoarthrosis)\b.{0,45}\bmedial (?:compartment|tibiofemoral)\b",
    "Lateral OA": r"\blateral (?:compartment|tibiofemoral)\b.{0,45}\b(?:osteoarthritis|osteoarthrosis)\b|\b(?:osteoarthritis|osteoarthrosis)\b.{0,45}\blateral (?:compartment|tibiofemoral)\b",
    "PF OA": r"\b(?:patellofemoral|patello.femoral)\b.{0,45}\b(?:osteoarthritis|osteoarthrosis)\b|\b(?:osteoarthritis|osteoarthrosis)\b.{0,45}\bpatellofemoral\b",
    "Effusion": r"\b(?:moderate|large|small|mild|trace)\s+(?:knee\s+|joint\s+|suprapatellar\s+)?effusion\b|\b(?:knee\s+|joint\s+|suprapatellar\s+)?effusion\s+(?:present|seen|noted)\b",
    "Synovitis": r"\b(?:active|diffuse|marked|mild|moderate|severe)\s+synovitis\b|\bsynovitis\s+(?:present|noted|seen)\b",
    "Baker's": r"\bbaker'?s?\s+cyst\b|\bpopliteal\s+cyst\b",
    "Contusion": r"\b(?:bone|osseous|marrow)\s+contusion\b|\bbone\s+bruise\b",
    "Fracture": r"\b(?:acute|subacute|nondisplaced|displaced|impaction)\s+(?:\w+\s+){0,2}fracture\b",
}
NEGATIVE = {
    **{k:rf"\b{v}\b\s+(?:is\s+)?intact\b|\bintact\s+{v}\b|\bno\s+(?:evidence\s+of\s+)?(?:tear|rupture)\s+(?:of\s+)?(?:the\s+)?{v}\b"
       for k,v in STRUCTURE.items()},
    "Medial OA": r"\bno\s+medial\s+(?:compartment\s+)?osteoarthritis\b",
    "Lateral OA": r"\bno\s+lateral\s+(?:compartment\s+)?osteoarthritis\b",
    "PF OA": r"\bno\s+patellofemoral\s+osteoarthritis\b",
    "Effusion": r"\b(?:no|without)\s+(?:significant\s+)?(?:knee\s+|joint\s+|suprapatellar\s+)?effusion\b",
    "Synovitis": r"\b(?:no|without)\s+(?:evidence\s+of\s+)?synovitis\b",
    "Baker's": r"\b(?:no|without)\s+(?:baker'?s?\s+cyst|popliteal\s+cyst)\b",
    "Contusion": r"\b(?:no|without)\s+(?:bone|osseous|marrow)\s+contusion\b|\bno\s+bone\s+bruise\b",
    "Fracture": r"\b(?:no|without)\s+(?:acute\s+)?fracture\b",
}
UNCERTAINTY = re.compile(r"\b(?:possible|possibly|probable|suspect(?:ed)?|cannot\s+exclude|question(?:able)?|may\s+represent|versus|vs\.?|history\s+of|prior|old|chronic|postsurgical|status\s+post)\b", re.I)
NEGATION = re.compile(r"\b(?:no|without|not|absence\s+of|negative\s+for)\b", re.I)


def candidate_states(report):
    if not isinstance(report, str):
        report = ""
    result = {label: "not_mentioned" for label in LABELS}
    if not report.strip():
        return result
    # Splitting at headings/newlines/semicolons limits the negation scope.
    # Do not translate or guess the status from absent mentions.
    clauses = re.split(r"[.;\n]+", report.lower())
    for label in LABELS:
        evidence = set()
        for clause in clauses:
            pos = bool(re.search(POSITIVE[label], clause))
            neg = bool(re.search(NEGATIVE[label], clause))
            if not pos and not neg:
                continue
            # A negative pattern must not be overridden by its own "no".
            # Contradictory affirmative/negative evidence in one clause abstains.
            if UNCERTAINTY.search(clause):
                evidence.add("uncertain")
            elif neg and not pos:
                evidence.add("negative")
            elif neg and pos:
                evidence.add("uncertain")
            elif pos and NEGATION.search(clause):
                evidence.add("uncertain")
            else:
                evidence.add("positive")
        if evidence:
            result[label] = next(iter(evidence)) if len(evidence) == 1 else "uncertain"
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
