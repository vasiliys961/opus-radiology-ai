"""Build a leakage-safe full-corpus research manifest from audited weak labels.

No reports/images/identifiers are logged or uploaded. Weak labels MUST already
be extracted and audited by an independent mechanism. Research only.
"""
import argparse
import csv
import json
from pathlib import Path
from rsna_knee import LABELS, read_rows, extract_labels


def build(gold_csv, weak_csv, original_manifest, output_csv, output_manifest):
    original={r["StudyInstanceUID"]:r for r in read_rows(gold_csv)}
    weak=read_rows(weak_csv)
    if not original or len(original)!=len(read_rows(gold_csv)):
        raise ValueError("Invalid original dataset or duplicate study identifiers")
    manifest=json.loads(Path(original_manifest).read_text(encoding="utf-8"))
    if manifest.get("label_schema")!=list(LABELS):
        raise ValueError("Wrong gold partition schema")
    gold_ids={uid for uid,r in original.items() if any(extract_labels(r)[1])}
    gold_train=set(manifest.get("train",()))
    gold_val=set(manifest.get("validation",()))
    if not gold_train or not gold_val or gold_train & gold_val or gold_train | gold_val != gold_ids:
        raise ValueError("Original gold manifest must exactly split gold cases")
    ids=[r["StudyInstanceUID"] for r in weak]
    if len(set(ids))!=len(ids) or set(ids)!=set(original):
        raise ValueError("Weak CSV must cover exactly the original train studies")
    combined=[]
    weak_studies=0
    for r in weak:
        uid=r["StudyInstanceUID"]
        original_labels,original_known=extract_labels(original[uid])
        candidate,candidate_known=extract_labels(r)
        if uid in gold_ids:
            # Never overwrite physician-reviewed labels, or backfill unknown
            # gold conditions with unverified pseudo-labels.
            values=[str(int(original_labels[j])) if original_known[j] else "" for j in range(len(LABELS))]
        else:
            values=[str(int(candidate[j])) if candidate_known[j] else "" for j in range(len(LABELS))]
            weak_studies+=int(any(candidate_known))
        combined.append({"StudyInstanceUID":uid,**dict(zip(LABELS,values))})
    eligible={r["StudyInstanceUID"] for r in combined if any(extract_labels(r)[1])}
    train=sorted(eligible-gold_val)
    val=sorted(gold_val)
    if set(train)&set(val) or not val or gold_train-set(train):
        raise ValueError("Invalid partition or missing gold training case")
    dest=Path(output_csv);meta=Path(output_manifest)
    dest.parent.mkdir(parents=True,exist_ok=True);meta.parent.mkdir(parents=True,exist_ok=True)
    with dest.open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
        w.writeheader();w.writerows(combined)
    meta.write_text(json.dumps({
        "label_schema":list(LABELS),"train":train,"validation":val,
        "seed":manifest.get("seed"),
        "status":"Research only: held-out GOLD validation, training contains audited weak labels",
        "weak_training_studies":weak_studies,
        "gold_validation_studies":len(val),
    },indent=2),encoding="utf-8")
    return {"train":len(train),"gold_validation":len(val),"weak_training":weak_studies}


def main():
    p=argparse.ArgumentParser()
    for name in ("gold-csv","weak-csv","gold-manifest","out-csv","out-manifest"):
        p.add_argument("--"+name,required=True)
    a=p.parse_args()
    print(json.dumps(build(a.gold_csv,a.weak_csv,a.gold_manifest,a.out_csv,a.out_manifest)))


if __name__=="__main__":
    main()
