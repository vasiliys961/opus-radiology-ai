"""Aggregate explanation for why candidate report labels fail gold calibration.

Never prints UIDs or report text; does not authorize weak labels.
"""
import argparse
import json
from pathlib import Path
from rsna_knee_report_audit import audit

def diagnostics(gold_csv,manifest,labels_jsonl):
    result=audit(gold_csv,manifest,labels_jsonl)
    explanations={}
    for name,entry in result["classes"].items():
        c=entry["counts"]
        pos=c["tp"]+c["fp"];neg=c["tn"]+c["fn"]
        reasons=[]
        if pos<10:reasons.append("insufficient_positive_predictions")
        if neg<10:reasons.append("insufficient_negative_predictions")
        if pos and entry["positive_precision_lower95"]<.8:
            reasons.append("positive_precision_confidence_below_threshold")
        if neg and entry["negative_predictive_lower95"]<.8:
            reasons.append("negative_predictive_confidence_below_threshold")
        explanations[name]={
            "tp":c["tp"],"fp":c["fp"],"tn":c["tn"],"fn":c["fn"],
            "unknown":c["unknown"],
            "positive_support":pos,"negative_support":neg,
            "positive_precision_lower95":entry["positive_precision_lower95"],
            "negative_predictive_lower95":entry["negative_predictive_lower95"],
            "eligible_for_review":entry["eligible_for_review"],
            "reasons":reasons or ["passed_audit_gates"],
        }
    return {"gold_train_n":result["gold_train_n"],"classes":explanations,
            "research_only":True,"approved_for_training":False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("gold-csv","manifest","labels-jsonl"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--output")
    a=p.parse_args()
    result=diagnostics(a.gold_csv,a.manifest,a.labels_jsonl)
    for name,entry in result["classes"].items():
        print(f"{name:20s} TP={entry['tp']:2d} FP={entry['fp']:2d} TN={entry['tn']:2d} FN={entry['fn']:2d} reasons={','.join(entry['reasons'])}")
    if a.output:Path(a.output).write_text(json.dumps(result,indent=2),encoding="utf-8")
if __name__=="__main__":main()
