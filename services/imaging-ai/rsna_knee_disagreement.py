"""Class-wise disagreement audit for two knee MRI classifiers. Research only."""
import argparse
import csv
import json
from pathlib import Path
from rsna_knee import LABELS
from rsna_knee_ensemble import read_prediction

def disagreement_rows(dino,coat,threshold=0.3):
    if not 0<=threshold<=1:
        raise ValueError("Disagreement threshold must be 0..1")
    a=read_prediction(dino)
    b=read_prediction(coat)
    if set(a)!=set(b):
        raise ValueError("Study ID sets do not match")
    results=[]
    for uid in sorted(a):
        for label,one,two in zip(LABELS,a[uid],b[uid]):
            gap=abs(one-two)
            results.append({
                "StudyInstanceUID":uid,
                "label":label,
                "dinov2_probability":one,
                "coatnet_probability":two,
                "absolute_gap":gap,
                "flagged":gap>=threshold,
            })
    return results

def write_report(dino,coat,out,threshold=0.3):
    rows=disagreement_rows(dino,coat,threshold)
    out=Path(out)
    out.parent.mkdir(parents=True,exist_ok=True)
    fields=("StudyInstanceUID","label","dinov2_probability",
            "coatnet_probability","absolute_gap","flagged")
    with out.open("w",newline="",encoding="utf-8") as f:
        writer=csv.DictWriter(f,fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    by_label={
        label:{"mean_abs_gap":sum(r["absolute_gap"] for r in rows if r["label"]==label)/max(1,sum(r["label"]==label for r in rows)),
               "flagged_studies":sum(r["flagged"] for r in rows if r["label"]==label)}
        for label in LABELS
    }
    summary={
        "studies":len(rows)//len(LABELS),
        "threshold":threshold,
        "total_flagged_pairs":sum(r["flagged"] for r in rows),
        "by_label":by_label,
        "caveat":"Inter-model disagreement is not evidence of pathology; both models can be wrong together.",
    }
    out.with_suffix(".summary.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    return summary

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dinov2",required=True)
    p.add_argument("--coatnet",required=True)
    p.add_argument("--out",required=True)
    p.add_argument("--threshold",type=float,default=.3)
    a=p.parse_args()
    print(json.dumps(write_report(a.dinov2,a.coatnet,a.out,a.threshold),ensure_ascii=False))

if __name__=="__main__":
    main()
