"""Create honest, disjoint RSNA Knee dataset partitions (CPU only).

Gold holdout remains sealed. Unlabeled MRI pool is NOT silently treated as
negative examples. IDs are written only to local files, never to stdout.
"""
import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from rsna_knee import LABELS, read_rows, extract_labels
from rsna_knee_validation import load_partition


def partition(root, manifest_path, output_dir):
    root=Path(root)
    rows=read_rows(root/"train.csv")
    gold_train,gold_val=load_partition(rows,manifest_path)
    identifiers=[r["StudyInstanceUID"] for r in rows]
    if len(set(identifiers))!=len(identifiers):
        raise ValueError("Duplicate study identifiers")
    train_ids={r["StudyInstanceUID"] for r in gold_train}
    val_ids={r["StudyInstanceUID"] for r in gold_val}
    pool=[r for r in rows if r["StudyInstanceUID"] not in train_ids|val_ids]
    if any(any(extract_labels(r)[1]) for r in pool):
        raise ValueError("Unassigned gold-labeled study would leak into unlabeled pool")
    if not train_ids or not val_ids or not pool:
        raise ValueError("Expected nonempty gold train, validation and unlabeled pool")
    series=read_rows(root/"train_series.csv")
    covered={r["StudyInstanceUID"] for r in series}
    if set(identifiers)-covered:
        raise ValueError("Some studies lack series metadata")
    dest=Path(output_dir)
    dest.mkdir(parents=True,exist_ok=True)
    sets={"gold_train":gold_train,"gold_validation":gold_val,"unlabeled_pool":pool}
    counts={}
    for name,items in sets.items():
        with (dest/(name+".csv")).open("w",newline="",encoding="utf-8") as f:
            writer=csv.DictWriter(f,fieldnames=["StudyInstanceUID",*LABELS])
            writer.writeheader()
            for row in items:
                values,known=extract_labels(row)
                output={"StudyInstanceUID":row["StudyInstanceUID"]}
                for i,label in enumerate(LABELS):
                    output[label]=str(int(values[i])) if known[i] else ""
                writer.writerow(output)
        counts[name]=len(items)
    balance={}
    for label_index,label in enumerate(LABELS):
        pos=neg=0
        for row in gold_train:
            values,known=extract_labels(row)
            if known[label_index]:
                if values[label_index]:pos+=1
                else:neg+=1
        balance[label]={"positive":pos,"negative":neg}
    summary={"partitions":counts,"gold_train_class_balance":balance,
             "total_studies":len(rows),"series_rows":len(series),
             "gold_holdout_isolated":True,
             "unlabeled_pool_has_no_imputed_negatives":True,
             "patient_level_leakage_checked":False,
             "ready_for_large_corpus_supervised_training":False,
             "warning":"Study-level partition only; do not treat unlabeled MRI as negative or weakly labeled."}
    (dest/"dataset_summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for flag in ("root","manifest","output"):
        p.add_argument("--"+flag,required=True)
    a=p.parse_args()
    print(json.dumps(partition(a.root,a.manifest,a.output),indent=2))
if __name__=="__main__":
    main()
