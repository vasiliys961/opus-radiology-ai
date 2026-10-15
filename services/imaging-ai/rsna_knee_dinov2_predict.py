"""Offline DINOv2 knee checkpoint inference for research only.

Never downloads model weights and never sends DICOM or reports to external APIs.
"""
import argparse
import csv
import json
from pathlib import Path

from rsna_knee import LABELS, read_rows, series_index, balanced_series, study_slices


def validate_checkpoint(checkpoint):
    """Reject foreign or incomplete checkpoints before model initialization."""
    if not isinstance(checkpoint,dict):
        raise ValueError("Expected a checkpoint dictionary")
    if checkpoint.get("model")!="dinov2-small-mil-v1":
        raise ValueError("Unexpected model architecture")
    if checkpoint.get("labels")!=list(LABELS):
        raise ValueError("Checkpoint label schema mismatch")
    if not isinstance(checkpoint.get("state_dict"),dict) or not checkpoint["state_dict"]:
        raise ValueError("Missing model parameters")
    for key in ("slices","series_limit"):
        value=checkpoint.get(key)
        if isinstance(value,bool) or not isinstance(value,int) or not 1<=value<=32:
            raise ValueError("Invalid checkpoint preprocessing setting: "+key)
    if checkpoint.get("series_selection","legacy") not in ("legacy","balanced"):
        raise ValueError("Unknown MRI series selection")
    if checkpoint.get("pixel_mode","legacy") not in ("legacy","dicom"):
        raise ValueError("Unknown MRI pixel mode")
    if checkpoint.get("slice_order","legacy") not in ("legacy","geometry-v2"):
        raise ValueError("Unknown MRI slice order")
    return checkpoint


def prediction_ids(csv_path):
    rows=read_rows(csv_path)
    if not rows:
        raise ValueError("Study list is empty")
    ids=[row["StudyInstanceUID"].strip() for row in rows]
    if any(not x for x in ids) or len(set(ids))!=len(ids):
        raise ValueError("Blank or duplicate StudyInstanceUID")
    return ids


def predict(args):
    import torch
    from rsna_knee_dinov2 import model_factory,preprocess
    path=Path(args.weights)
    if not path.is_file():
        raise FileNotFoundError(path)
    ckpt=validate_checkpoint(torch.load(path,map_location="cpu",weights_only=True))
    index=(balanced_series(read_rows(args.series_csv),max_series=ckpt["series_limit"])
           if ckpt.get("series_selection","legacy")=="balanced" else series_index(read_rows(args.series_csv)))
    ids=prediction_ids(args.studies_csv)
    absent=set(ids)-set(index)
    if absent:
        raise ValueError(f"{len(absent)} studies have no eligible MRI series")
    # No network: instantiate architecture from config, then load the entire checkpoint.
    model=model_factory(pretrained=False)
    model.load_state_dict(ckpt["state_dict"],strict=True)
    device=torch.device("cuda" if args.device=="auto" and torch.cuda.is_available()
                        else args.device if args.device!="auto" else "cpu")
    model.to(device).eval()
    out=Path(args.output)
    out.parent.mkdir(parents=True,exist_ok=True)
    tmp=out.with_name(out.name+".partial")
    try:
        with tmp.open("w",newline="",encoding="utf-8") as f:
            writer=csv.writer(f)
            writer.writerow(["StudyInstanceUID",*LABELS])
            with torch.inference_mode():
                for count,uid in enumerate(ids,1):
                    images=study_slices(Path(args.dicom_root),index,uid,
                                       ckpt["slices"],ckpt["series_limit"],
                                        series_order="provided" if ckpt.get("series_selection","legacy")=="balanced" else "legacy",
                                        pixel_mode=ckpt.get("pixel_mode","legacy"),
                                        slice_order=ckpt.get("slice_order","legacy")).to(device)
                    probabilities=model(preprocess(images)).sigmoid().cpu().tolist()
                    if len(probabilities)!=len(LABELS):
                        raise ValueError("Model output does not match label schema")
                    writer.writerow([uid,*probabilities])
                    if count%50==0:
                        print(json.dumps({"completed":count,"total":len(ids)}),flush=True)
        tmp.replace(out)
    finally:
        tmp.unlink(missing_ok=True)
    print("Predictions:",out,"studies:",len(ids),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights",required=True,help="Existing offline DINOv2 checkpoint .pt")
    parser.add_argument("--studies-csv",required=True,help="CSV with StudyInstanceUID, e.g. test.csv")
    parser.add_argument("--series-csv",required=True)
    parser.add_argument("--dicom-root",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--device",choices=("auto","cuda","cpu"),default="auto")
    args=parser.parse_args()
    predict(args)


if __name__=="__main__":
    main()
