#!/usr/bin/env python3
"""Permission-gated ORIGINAL adrenal-tumor nnU-Net v2 offline research executor.

Do not fetch gated model assets or CT images. Only fully licensed locally
installed author weights with a verified author-produced 128x192x192 ROI,
original CT-derived HU and mm affine. Results remain PRIVATE and research-only.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

MODEL="yunnaa/Adrenal-Tumor-nnUNet"
FOLD_IDS=("0","1","2","3","4")
CONFIG="nnUNetTrainer__nnUNetPlans__3d_fullres"
TASK="Dataset001_AdrenalTumor"
MAX_VOXELS=128*192*192


def sha256(path):
    d=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024**2),b""):
            d.update(chunk)
    return d.hexdigest()


def check_ontology(dataset_json):
    labels=json.loads(Path(dataset_json).read_text(encoding="utf8")).get("labels")
    if (not isinstance(labels,dict) or labels.get("background")!=0
            or sorted(labels.values())!=[0,1,2]):
        raise ValueError("author adrenal ontology must contain background0 gland1 tumor2")
    if not any("tumor" in str(k).lower() and v==2 for k,v in labels.items()):
        raise ValueError("author tumor label2 not explicitly confirmed")
    return labels


def inspect_roi(path):
    import nibabel as nib
    import numpy as np
    if (path.is_symlink() or not path.is_file() or
            not path.name.endswith("_0000.nii.gz")
            or not 1024<path.stat().st_size<400*1024**2):
        raise ValueError("single original author-preprocessed 3D CT ROI required")
    image=nib.load(str(path))
    spacing=image.header.get_zooms()[:3]
    if (image.ndim!=3 or math.prod(image.shape)!=MAX_VOXELS
        or sorted(image.shape)!=sorted([128,192,192])
        or image.header.get_xyzt_units()[0]!="mm"
        or not np.isfinite(image.affine).all()
        or abs(np.linalg.det(image.affine[:3,:3]))<1e-7
        or any(not .95<=float(z)<=1.05 for z in spacing)):
        raise ValueError("author 128x192x192 1mm isotropic physical CT ROI required")
    for z in (0,image.shape[2]//2,image.shape[2]-1):
        if not np.isfinite(np.asarray(image.dataobj[:,:,z])).all():
            raise ValueError("nonfinite source CT ROI")
    return image


def inspect_prediction(source,prediction):
    import nibabel as nib
    import numpy as np
    if prediction.is_symlink() or not prediction.is_file():
        raise RuntimeError("original trained adrenal model did not write an ordinary mask")
    image=nib.load(str(prediction))
    if (image.shape!=source.shape or image.ndim!=3 or
            image.header.get_xyzt_units()[0]!="mm" or
            not np.allclose(image.affine,source.affine,atol=1e-3,rtol=0)):
        raise ValueError("predicted gland/tumor mask off original ROI grid")
    totals={0:0,1:0,2:0}
    for z in range(image.shape[2]):
        a=np.asarray(image.dataobj[:,:,z])
        if not np.isfinite(a).all() or not np.isin(a,(0,1,2)).all():
            raise ValueError("author prediction mask ontology mismatch")
        for label in totals:
            totals[label]+=int(np.count_nonzero(a==label))
    return totals


def native_adrenal_tumor_candidates(source, prediction, minimum_voxels=10):
    """Real label-2 instance geometry only; never diagnose adrenal malignancy."""
    import numpy as np
    from scipy import ndimage
    if not 1<=minimum_voxels<=100:
        raise ValueError("unsupported_adrenal_candidate_volume_threshold")
    a=np.asarray(prediction)
    if (a.ndim!=3 or a.shape!=source.shape or a.size!=MAX_VOXELS or
            not np.isin(a,(0,1,2)).all()):
        raise ValueError("original_adrenal_prediction_ontology_or_grid_invalid")
    labels,n=ndimage.label(a==2,ndimage.generate_binary_structure(3,3))
    if n>100000:raise ValueError("unbounded_adrenal_components")
    volume=abs(float(np.linalg.det(source.affine[:3,:3])))
    candidates=[]
    for i,region in enumerate(ndimage.find_objects(labels),1):
        if region is None:continue
        component=labels[region]==i
        count=int(np.count_nonzero(component))
        if count<minimum_voxels:continue
        center=np.asarray(ndimage.center_of_mass(component))+[s.start for s in region]
        ras=(source.affine@np.r_[center,1])[:3]
        candidates.append({
            "nativeRoiVoxelBoundsIJK":[[int(s.start),int(s.stop-1)] for s in region],
            "nativeRoiCentroidIJK":[round(float(x),3) for x in center],
            "sourceNiftiRASmm":[round(float(x),3) for x in ras],
            "volumeMl":round(count*volume/1000,5),
            "voxelCount":count,
            "adrenalMalignancyConfirmed":False})
        if len(candidates)>128:
            raise ValueError("excessive_adrenal_tumor_candidates")
    return sorted(candidates,key=lambda x:x["voxelCount"],reverse=True)

def run(roi,results,output,*,expected_roi_sha,checkpoint_sha,license_approved,execute):
    if not license_approved:
        raise PermissionError("official gated model terms must be accepted by authorized human")
    roi=Path(roi).expanduser().resolve(strict=True)
    results=Path(results).expanduser().resolve(strict=True)
    out=Path(output).expanduser().resolve()
    if not re.fullmatch("[a-f0-9]{64}",expected_roi_sha):
        raise ValueError("exact original ROI SHA256 required")
    if sha256(roi)!=expected_roi_sha:
        raise ValueError("original CT ROI bytes not the declared research source")
    source=inspect_roi(roi)
    if out==roi.parent or out.is_relative_to(roi.parent) or out.is_relative_to(results):
        raise ValueError("isolate prediction from CT and original weights")
    folder=results/TASK/CONFIG
    labels=check_ontology(results/TASK/"dataset.json")
    checkpoints={}
    for fold in FOLD_IDS:
        p=folder/("fold_"+fold)/"checkpoint_best.pth"
        if p.is_symlink() or not p.is_file() or not 1_000_000<p.stat().st_size<2*1024**3:
            raise ValueError("author gated model genuine fold "+fold+" missing")
        checkpoints[fold]=sha256(p)
    if not re.fullmatch("[a-f0-9]{64}",checkpoint_sha) or checkpoints["0"]!=checkpoint_sha:
        raise ValueError("original author fold0 checkpoint SHA mismatch")
    summary={"model":MODEL,"ontology":labels,"sourceROISha256":expected_roi_sha,
             "originalWeightFoldSha256":checkpoints,"originalTrainedForward":False,
             "clinicalValidation":False,"completeAbdominalCTCoverage":False,"publisherBytesIndependentlyVerified":False,
             "roiBacktransformToOriginalDICOMProven":False}
    if not execute:return summary
    if not sys.platform.startswith("linux"):
        raise RuntimeError("heavy nnU-Net 3D research inference is isolated Linux-worker only; not user Mac")
    mem=Path("/proc/meminfo").read_text().splitlines()
    available=next(int(line.split()[1]) for line in mem if line.startswith("MemAvailable:"))
    if available < 16*1024*1024:
        raise RuntimeError("original adrenal nnU-Net requires >=16GiB free Linux worker memory")
    if shutil.which("nnUNetv2_predict") is None:
        raise RuntimeError("original nnUNetv2_predict executable missing")
    if len(list(roi.parent.glob("*_0000.nii.gz")))!=1:
        raise ValueError("one CT case per private executor input directory")
    if out.exists():
        raise ValueError("refuse stale prediction directory")
    out.mkdir(mode=0o700,parents=True)
    env=os.environ.copy()
    for k in ("nnUNet_raw","nnUNet_preprocessed"):
        p=out/k
        p.mkdir(mode=0o700)
        env[k]=str(p)
    env["nnUNet_results"]=str(results)
    cmd=["nnUNetv2_predict","-i",str(roi.parent),"-o",str(out),"-d","001",
         "-c","3d_fullres","-f",*FOLD_IDS,"-chk","checkpoint_best.pth",
         "-device","cpu","-npp","1","-nps","1","--disable_tta"]
    subprocess.run(cmd,env=env,check=True,timeout=7200)
    pred=out/(roi.name[:-12]+".nii.gz")
    counts=inspect_prediction(source,pred)
    import nibabel as nib
    import numpy as np
    candidates=native_adrenal_tumor_candidates(source,np.asarray(nib.load(str(pred)).dataobj))
    if sha256(roi)!=expected_roi_sha:
        raise ValueError("source changed during genuine model forward")
    summary.update({"originalTrainedForward":True,"originalMaskSha256":sha256(pred),
                    "classCountNotDiagnosis":{"background":counts[0],"adrenal_gland":counts[1],"tumor_candidates":counts[2]},
                    "negativeTumorFindingNotEstablished":True,
                    "nativeRoiTumorCandidates":candidates,
                    "nativeRoiOnlyNotOriginalFullCT":True,
                    "independentExpertTumorDice":None})
    report=out/"adrenal-research-numeric.json"
    report.write_text(json.dumps(summary,indent=2)+"\n",encoding="utf8")
    return summary


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--roi",type=Path,required=True)
    p.add_argument("--nnunet-results",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--roi-sha256",required=True)
    p.add_argument("--fold0-checkpoint-sha256",required=True)
    p.add_argument("--human-accepted-official-gated-license",action="store_true")
    p.add_argument("--execute",action="store_true")
    a=p.parse_args()
    try:
        record=run(a.roi,a.nnunet_results,a.output,
            expected_roi_sha=a.roi_sha256,checkpoint_sha=a.fold0_checkpoint_sha256,
            license_approved=a.human_accepted_official_gated_license,execute=a.execute)
        print(json.dumps(record,ensure_ascii=False,indent=2))
    except (OSError,ValueError,PermissionError,ImportError,RuntimeError,subprocess.SubprocessError) as e:
        print("ADRENAL RESEARCH REFUSED: "+str(e),file=sys.stderr)
        return 1
    return 0


if __name__=="__main__":
    raise SystemExit(main())
