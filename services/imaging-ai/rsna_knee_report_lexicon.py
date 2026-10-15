"""Offline, PHI-safe terminology coverage for RSNA Knee Report text.

Counts predefined anatomy and clinical concept terms across the full corpus,
then aggregates recognized/unrecognized candidate labels on GOLD TRAIN only.
No raw report, study identifier, or holdout-derived metric is emitted.
Does not label cases or trigger training.
"""
import argparse
import json
import re
from collections import Counter
from pathlib import Path
from rsna_knee import LABELS, read_rows, extract_labels
from rsna_knee_label_prep import load_jsonl, STATES
from rsna_knee_validation import load_partition

TERMS = {
    "ACL": (r"\bacl\b", r"\banterior cruciate ligament\b", r"\bcruciate\b"),
    "MCL": (r"\bmcl\b", r"\bmedial collateral ligament\b", r"\bcollateral ligament\b"),
    "Medial Meniscus": (r"\bmedial meniscus\b", r"\bmedial meniscal\b", r"\bposterior horn\b"),
    "Lateral Meniscus": (r"\blateral meniscus\b", r"\blateral meniscal\b", r"\banterior horn\b"),
    "Medial OA": (r"\bmedial compartment\b", r"\bmedial tibiofemoral\b", r"\bjoint space narrowing\b"),
    "Lateral OA": (r"\blateral compartment\b", r"\blateral tibiofemoral\b", r"\bosteophytes?\b"),
    "PF OA": (r"\bpatellofemoral\b", r"\bpatellar cartilage\b", r"\bchondromalacia\b"),
    "Effusion": (r"\beffusion\b", r"\bjoint fluid\b", r"\bsuprapatellar fluid\b"),
    "Synovitis": (r"\bsynovitis\b", r"\bsynovial thickening\b", r"\bsynovial hypertrophy\b"),
    "Baker's": (r"\bbaker'?s?\b", r"\bpopliteal cyst\b", r"\bgastrocnemius.semimembranosus\b"),
    "Contusion": (r"\bcontusion\b", r"\bbone bruis(?:e|ing)\b", r"\bmarrow edema\b"),
    "Fracture": (r"\bfracture\b", r"\bfracture line\b", r"\bimpaction injury\b"),
}


def profile(gold_csv, manifest_path, candidates_jsonl):
    rows=read_rows(gold_csv)
    train,_=load_partition(rows,manifest_path)
    source={row["StudyInstanceUID"]:row for row in rows}
    if len(source)!=len(rows):
        raise ValueError("Duplicate study IDs")
    candidates=dict(load_jsonl(candidates_jsonl))
    if set(candidates)!=set(source):
        raise ValueError("Candidate IDs must match train.csv exactly")
    lexicon={key:Counter() for key in LABELS}
    for row in rows:
        report=row.get("Report","") or ""
        for label in LABELS:
            for term in TERMS[label]:
                if re.search(term,report,re.I):
                    lexicon[label][term]+=1
    gaps={label:Counter() for label in LABELS}
    for row in train:
        values,mask=extract_labels(row)
        candidate=candidates[row["StudyInstanceUID"]]
        report=row.get("Report","") or ""
        for i,label in enumerate(LABELS):
            if not mask[i]:
                continue
            truth=int(values[i])
            state=STATES[candidate[label]]
            if state is not None:
                gaps[label]["recognized"]+=1
                continue
            gaps[label]["abstained_gold_positive" if truth else "abstained_gold_negative"]+=1
            if any(re.search(term,report,re.I) for term in TERMS[label]):
                gaps[label]["abstained_with_anatomy_term"]+=1
    return {
      "total_studies":len(rows),
      "gold_train_n":len(train),
      "term_presence":{k:dict(v) for k,v in lexicon.items()},
      "gold_train_coverage":{k:dict(v) for k,v in gaps.items()},
      "research_only":True,
      "warning":"Terms are overlapping and non-diagnostic; zero use of gold validation labels."
    }


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--train-csv",required=True)
    p.add_argument("--manifest",required=True)
    p.add_argument("--candidates",required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args()
    result=profile(a.train_csv,a.manifest,a.candidates)
    path=Path(a.output);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding="utf-8")
    for label,stats in result["gold_train_coverage"].items():
        print(f"{label:20s} recognized={stats.get('recognized',0):2d} "
              f"abstain_gold+={stats.get('abstained_gold_positive',0):2d} "
              f"abstain_gold-={stats.get('abstained_gold_negative',0):2d} "
              f"has_term={stats.get('abstained_with_anatomy_term',0):2d}")
    print("Term counts are not labels. No GPU or training.")
if __name__=="__main__":
    main()
