"""Offline study-level inference for DINOv2 finding-specific MIL v2."""
import argparse
import csv
from pathlib import Path
from rsna_knee import LABELS,read_rows,balanced_series,series_index,study_slices
from rsna_knee_finding_mil import make_finding_mil
from rsna_knee_dinov2_predict import prediction_ids


def validate(ckpt):
    if ckpt.get("model")!="dinov2-small-finding-mil-v2" or ckpt.get("head_family")!="finding-v2":
        raise ValueError("Unsupported finding-specific architecture")
    if ckpt.get("labels")!=list(LABELS):
        raise ValueError("Wrong label schema")
    if not isinstance(ckpt.get("state_dict"),dict) or not isinstance(ckpt.get("head_state_dict"),dict):
        raise ValueError("Missing model weights")
    for field in ("slices","series_limit"):
        if type(ckpt.get(field)) is not int or not 1<=ckpt[field]<=32:
            raise ValueError("Invalid preprocessing size")
    if ckpt.get("series_selection") not in ("legacy","balanced") or ckpt.get("slice_order") not in ("legacy","geometry-v2") or ckpt.get("pixel_mode") not in ("legacy","dicom"):
        raise ValueError("Unsupported preprocessing mode")
    return ckpt


def predict(args):
    import torch
    from rsna_knee_dinov2 import model_factory,preprocess
    ckpt=validate(torch.load(args.weights,map_location="cpu",weights_only=True))
    model=model_factory(pretrained=False)
    model.load_state_dict(ckpt["state_dict"],strict=True)
    head=make_finding_mil(384,findings=len(LABELS))
    head.load_state_dict(ckpt["head_state_dict"],strict=True)
    device="cuda" if args.device=="auto" and torch.cuda.is_available() else "cpu" if args.device=="auto" else args.device
    model.to(device).eval();head.to(device).eval()
    rows=read_rows(args.series_csv)
    index=balanced_series(rows,ckpt["series_limit"]) if ckpt["series_selection"]=="balanced" else series_index(rows)
    ids=prediction_ids(args.studies_csv)
    if not set(ids)<=set(index):
        raise ValueError("Missing eligible MRI series")
    dest=Path(args.output);dest.parent.mkdir(parents=True,exist_ok=True)
    tmp=dest.with_name(dest.name+".partial")
    try:
        with tmp.open("w",encoding="utf-8",newline="") as f:
            writer=csv.writer(f);writer.writerow(["StudyInstanceUID",*LABELS])
            with torch.inference_mode():
                for uid in ids:
                    images=study_slices(Path(args.dicom_root),index,uid,
                        ckpt["slices"],ckpt["series_limit"],
                        series_order="provided" if ckpt["series_selection"]=="balanced" else "legacy",
                        pixel_mode=ckpt["pixel_mode"],slice_order=ckpt["slice_order"])
                    parts=[]
                    for block in images.split(args.slice_batch):
                        features=model.backbone(pixel_values=preprocess(block.to(device))).last_hidden_state[:,0,:]
                        parts.append(features)
                    probabilities=head(torch.cat(parts,dim=0)).sigmoid().cpu().tolist()
                    writer.writerow([uid,*probabilities])
        tmp.replace(dest)
    finally:
        tmp.unlink(missing_ok=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("weights","studies-csv","series-csv","dicom-root","output"):
        p.add_argument("--"+key,required=True)
    p.add_argument("--slice-batch",type=int,default=8)
    p.add_argument("--device",choices=("auto","cuda","cpu"),default="auto")
    args=p.parse_args()
    if args.slice_batch<1:raise ValueError("slice-batch must be positive")
    predict(args)


if __name__=="__main__":main()
