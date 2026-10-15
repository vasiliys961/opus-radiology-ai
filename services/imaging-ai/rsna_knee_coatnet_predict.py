"""Offline CoAtNet 12-label knee-MRI checkpoint inference (research only)."""
import argparse
import csv
from pathlib import Path
from rsna_knee import LABELS,read_rows,series_index,balanced_series,study_slices
from rsna_knee_dinov2_predict import prediction_ids

def validate_checkpoint(ckpt):
    if not isinstance(ckpt,dict) or ckpt.get("family")!="coatnet-attention-mil-v1":
        raise ValueError("Unknown CoAtNet checkpoint")
    if ckpt.get("labels")!=list(LABELS):
        raise ValueError("Wrong label order or schema")
    if not isinstance(ckpt.get("state_dict"),dict) or not ckpt["state_dict"]:
        raise ValueError("Missing model state")
    architecture=ckpt.get("architecture")
    if not isinstance(architecture,str) or not architecture.startswith("coatnet_"):
        raise ValueError("Unexpected architecture name")
    for key in ("slices","series_limit"):
        value=ckpt.get(key)
        if type(value) is not int or not 1<=value<=32:
            raise ValueError("Unsafe or invalid preprocessing: "+key)
    if ckpt.get("series_selection","legacy") not in ("legacy","balanced"):
        raise ValueError("Unknown MRI series selection")
    if ckpt.get("pixel_mode","legacy") not in ("legacy","dicom"):
        raise ValueError("Unknown MRI pixel mode")
    return ckpt

def predict(args):
    import torch
    from rsna_knee_coatnet import build_model,normalize
    ckpt=validate_checkpoint(torch.load(args.weights,map_location="cpu",weights_only=True))
    # timm creates architecture without pretrained weights, avoiding model network access.
    model=build_model(pretrained=False,architecture=ckpt["architecture"])
    model.load_state_dict(ckpt["state_dict"],strict=True)
    device=torch.device("cuda" if args.device=="auto" and torch.cuda.is_available()
                        else "cpu" if args.device=="auto" else args.device)
    model.to(device).eval()
    index=(balanced_series(read_rows(args.series_csv),max_series=ckpt["series_limit"])
           if ckpt.get("series_selection","legacy")=="balanced" else series_index(read_rows(args.series_csv)))
    ids=prediction_ids(args.studies_csv)
    if not set(ids)<=set(index):
        raise ValueError("Study IDs missing from series index")
    output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    temporary=output.with_name(output.name+".partial")
    try:
        with temporary.open("w",newline="",encoding="utf-8") as f:
            writer=csv.writer(f)
            writer.writerow(["StudyInstanceUID",*LABELS])
            with torch.inference_mode():
                for uid in ids:
                    images=study_slices(Path(args.dicom_root),index,uid,
                                        ckpt["slices"],ckpt["series_limit"],
                                        series_order="provided" if ckpt.get("series_selection","legacy")=="balanced" else "legacy",
                                        pixel_mode=ckpt.get("pixel_mode","legacy")).to(device)
                    probabilities=model(normalize(images)).sigmoid().cpu().tolist()
                    if len(probabilities)!=len(LABELS):
                        raise ValueError("Output schema mismatch")
                    writer.writerow([uid,*probabilities])
        temporary.replace(output)
    finally:
        temporary.unlink(missing_ok=True)
    print("Offline CoAtNet predictions:",output,flush=True)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("weights","studies-csv","series-csv","dicom-root","output"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--device",choices=("auto","cuda","cpu"),default="auto")
    predict(p.parse_args())

if __name__=="__main__":
    main()
