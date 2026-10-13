"""Reference-bound streaming Dice for independently annotated five-lobe CT masks.

Research scoring only. No annotations are downloaded or synthesized here.
Requires SHA-bound prediction report and an independently supplied reference manifest.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import struct

import numpy as np

LOBE_IDS=(10,11,12,13,14)
DTYPES={2: (1,np.dtype("u1")),512: (2,np.dtype("<u2"))}
MAX_SHAPE=(512,512,300)
BLOCK_VOXELS=65536


def file_sha256(path):
    digest=hashlib.sha256()
    with Path(path).open("rb") as fd:
        while block:=fd.read(128*1024):
            digest.update(block)
    return digest.hexdigest()


def _read_json(path):
    value=json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value,dict):
        raise ValueError("invalid_manifest")
    return value


def _is_sha(value):
    return isinstance(value,str) and len(value)==64 and all(ch in "0123456789abcdef" for ch in value)


def mask_header(path):
    """Inspect uncompressed, little-endian native-grid NIfTI without allocating the 3D array."""
    path=Path(path)
    if path.is_symlink():
        raise ValueError("unsafe_mask_path")
    fd=os.open(path,os.O_RDONLY | getattr(os,"O_NOFOLLOW",0))
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size<353:
            raise ValueError("invalid_mask_file")
        header=os.read(fd,352)
    finally:
        os.close(fd)
    if (len(header)!=352 or struct.unpack_from("<i",header)[0]!=348
            or header[344:348]!=b"n+1\x00"
            or struct.unpack_from("<h",header,40)[0]!=3):
        raise ValueError("invalid_mask_header")
    shape=tuple(int(n) for n in struct.unpack_from("<3h",header,42))
    if any(not 1<=dim<=limit for dim,limit in zip(shape,MAX_SHAPE)):
        raise ValueError("unsupported_grid")
    code,bits=struct.unpack_from("<hh",header,70)
    if code not in DTYPES or bits!=8*DTYPES[code][0]:
        raise ValueError("unsupported_label_datatype")
    if struct.unpack_from("<f",header,108)[0]!=352.:
        raise ValueError("unsupported_nifti_offset")
    slope,intercept=struct.unpack_from("<ff",header,112)
    if (slope not in (0.,1.)) or intercept!=0.:
        raise ValueError("scaled_labels_unsupported")
    if not 1<=struct.unpack_from("<h",header,254)[0]<=4:
        raise ValueError("missing_sform_geometry")
    affine=np.array(struct.unpack_from("<12f",header,280),dtype=np.float64).reshape(3,4)
    if not np.isfinite(affine).all():
        raise ValueError("invalid_affine")
    nvox=math.prod(shape)
    if info.st_size!=352+nvox*DTYPES[code][0]:
        raise ValueError("invalid_mask_file")
    return {"shape":shape,"affine":affine,"count":nvox,
            "stride":DTYPES[code][0],"dtype":DTYPES[code][1]}


def _geometry_agrees(a,b):
    if a["shape"]!=b["shape"]:
        return False
    shape=a["shape"]
    corners=np.asarray([[x,y,z,1.] for x in (0,shape[0]-1)
                        for y in (0,shape[1]-1)
                        for z in (0,shape[2]-1)],dtype=np.float64)
    diff=corners @ (a["affine"]-b["affine"]).T
    return bool(np.linalg.norm(diff,axis=1).max()<=0.05)


def benchmark(prediction, prediction_report, reference, reference_manifest):
    pred=Path(prediction)
    truth=Path(reference)
    if pred.is_symlink() or truth.is_symlink() or pred.resolve()==truth.resolve():
        raise ValueError("non_independent_masks")
    report=_read_json(prediction_report)
    meta=_read_json(reference_manifest)
    if (report.get("schema")!="opus-totalseg-first-inference/v1"
            or report.get("status")!="completed_unvalidated"
            or not _is_sha(report.get("sourceSha256"))
            or not _is_sha(report.get("maskSha256"))):
        raise ValueError("unverified_prediction_report")
    if (meta.get("schema")!="opus-totalseg-independent-reference/v1"
            or meta.get("sourceSha256")!=report["sourceSha256"]
            or not _is_sha(meta.get("maskSha256"))
            or meta.get("independentAnnotationAttested") is not True
            or meta.get("annotationMethod") not in
               ("expert_manual","curated_reference")
            or meta.get("licensedForResearch") is not True):
        raise ValueError("reference_provenance_not_confirmed")
    if report["maskSha256"]==meta["maskSha256"]:
        raise ValueError("non_independent_masks")
    if file_sha256(pred)!=report["maskSha256"]:
        raise ValueError("prediction_sha_mismatch")
    if file_sha256(truth)!=meta["maskSha256"]:
        raise ValueError("reference_sha_mismatch")
    a,b=mask_header(pred),mask_header(truth)
    if not _geometry_agrees(a,b):
        raise ValueError("mask_geometry_mismatch")
    pred_count={i:0 for i in LOBE_IDS}
    truth_count={i:0 for i in LOBE_IDS}
    intersect={i:0 for i in LOBE_IDS}
    with pred.open("rb") as pd,truth.open("rb") as rd:
        pd.seek(352);rd.seek(352)
        remain=a["count"]
        while remain:
            take=min(BLOCK_VOXELS,remain)
            ap=np.frombuffer(pd.read(take*a["stride"]),dtype=a["dtype"])
            gt=np.frombuffer(rd.read(take*b["stride"]),dtype=b["dtype"])
            if len(ap)!=take or len(gt)!=take:
                raise ValueError("truncated_mask")
            if (not np.isin(ap,(0,*LOBE_IDS)).all()
                    or not np.isin(gt,(0,*LOBE_IDS)).all()):
                raise ValueError("unexpected_mask_label")
            for label in LOBE_IDS:
                aa=ap==label
                bb=gt==label
                pred_count[label]+=int(np.count_nonzero(aa))
                truth_count[label]+=int(np.count_nonzero(bb))
                intersect[label]+=int(np.count_nonzero(aa & bb))
            remain-=take
    rows=[]
    for label in LOBE_IDS:
        p=pred_count[label];t=truth_count[label];tp=intersect[label]
        # Both absent is undefined, not a perfect score.
        value=(2.*tp/(p+t)) if t>0 else None
        rows.append({"labelId":label,"predictedVoxels":p,
                     "referenceVoxels":t,"intersectionVoxels":tp,
                     "dice":round(value,6) if value is not None else None,
                     "referencePresent":t>0})
    complete=all(row["referencePresent"] for row in rows)
    return {"schema":"opus-totalseg-independent-lobe-dice/v1",
            "sourceSha256":report["sourceSha256"],
            "predictionSha256":report["maskSha256"],
            "referenceSha256":meta["maskSha256"],
            "geometryMaxCornerToleranceMm":0.05,
            "referenceIndependence":"user_attested_not_independently_audited",
            "lobeDice":rows,
            "macroDice":round(sum(row["dice"] for row in rows)/len(rows),6) if complete else None,
            "allFiveReferenceLabelsPresent":complete,
            "qualityStatus":"research_metrics_not_clinically_validated",
            "readyForClinicalUse":False}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prediction",required=True,type=Path)
    parser.add_argument("--prediction-report",required=True,type=Path)
    parser.add_argument("--reference",required=True,type=Path)
    parser.add_argument("--reference-manifest",required=True,type=Path)
    args=parser.parse_args()
    try:
        result=benchmark(args.prediction,args.prediction_report,
                         args.reference,args.reference_manifest)
    except (OSError,ValueError,KeyError,TypeError,OverflowError) as exc:
        import sys
        print(json.dumps({"status":"failed","errorType":type(exc).__name__}),file=sys.stderr)
        return 2
    print(json.dumps(result,sort_keys=True))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
