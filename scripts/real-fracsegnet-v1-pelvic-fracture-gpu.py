#!/usr/bin/env python3
"""Original FracSegNet nnU-Net v1 pelvic fracture-fragment research inference.

Only on EXTRACTED bone ROI provided by original upstream anatomy stage.
GPU 10+ GiB; not executable on user Mac or arbitrary complete pelvis CT.
Weights are separately installed from the official author's Google Drive.
No diagnosis or clinical false-negative screen.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

AUTHOR="https://github.com/YzzLiu/FracSegNet"
MODEL_SOURCE="https://drive.google.com/file/d/1tBnXpmSlbJBx_EloS1evumVVMILYRl6Q/view"
SCHEMA="opus-fracsegnet-pelvis-genuine-model-research/v1"
MAX_SOURCE_BYTES=800*1024**2
MAX_VOXELS=512*512*520


def sha256(file: Path):
    h=hashlib.sha256()
    with file.open("rb") as stream:
        for buf in iter(lambda:stream.read(1024**2),b""):
            h.update(buf)
    return h.hexdigest()


def trusted_digest(value: str) -> bool:
    return isinstance(value,str) and re.fullmatch("[0-9a-f]{64}",value) is not None


def inspect_original_roi(path: Path):
    import nibabel as nib
    import numpy as np
    if (path.is_symlink() or not path.is_file() or
            not 1024 <= path.stat().st_size <= MAX_SOURCE_BYTES or
            not path.name.endswith(".nii.gz")):
        raise ValueError("approved_original_fracture_roi_nifti_required")
    image=nib.load(str(path))
    affine=np.asarray(image.affine,dtype=float)
    if (image.ndim!=3 or min(image.shape)<24 or
        math.prod(image.shape)>MAX_VOXELS or
        affine.shape!=(4,4) or not np.isfinite(affine).all() or
        abs(float(np.linalg.det(affine[:3,:3])))<1e-7):
        raise ValueError("invalid_original_pelvic_roi_geometry")
    return image


def inspect_original_model(path:Path, root:Path, expected_sha:str):
    if not trusted_digest(expected_sha):
        raise ValueError("independently_recorded_vendor_checkpoint_SHA256_required")
    p=path.resolve()
    base=root.resolve()
    if (path.is_symlink() or not p.is_relative_to(base) or
        not p.is_file() or p.stat().st_size<1024**2 or
        p.suffix != ".model"):
        raise ValueError("installed_original_FracSegNet_weight_file_required")
    if sha256(p)!=expected_sha:
        raise ValueError("original_fracture_network_checkpoint_SHA_mismatch")
    if not p.with_name(p.name+".pkl").is_file():
        raise ValueError("nnunet_v1_model_training_plan_missing")
    return p


def output_fragments(source:Path, prediction:Path):
    import nibabel as nib
    import numpy as np
    from scipy import ndimage
    src=inspect_original_roi(source)
    img=nib.load(str(prediction))
    if (img.ndim!=3 or img.shape!=src.shape or
        not np.allclose(img.affine,src.affine,rtol=0,atol=.02)):
        raise ValueError("actual_FractureSeg_mask_not_on_original_bone_ROI_grid")
    a=np.asarray(img.dataobj)
    if (not np.isfinite(a).all() or not np.equal(a,np.rint(a)).all()
         or np.min(a)<0 or np.max(a)>30):
        raise ValueError("original_fragment_output_labels_invalid")
    labels,n=ndimage.label(a>0,structure=ndimage.generate_binary_structure(3,1))
    voxel_ml=abs(float(np.linalg.det(src.affine[:3,:3])))/1000
    found=[]
    for idx,region in enumerate(ndimage.find_objects(labels),1):
        if region is None:continue
        mask=labels[region]==idx
        voxels=int(np.count_nonzero(mask))
        if voxels<10:continue
        center=np.asarray(ndimage.center_of_mass(mask))+np.array([s.start for s in region])
        world=(src.affine@np.r_[center,1])[:3]
        found.append({"originalRoiVoxelBox":[[int(s.start),int(s.stop-1)] for s in region],
                      "roiVoxelCenterIJK":[round(float(x),3) for x in center],
                      "sourceNiftiWorldCenterMm":[round(float(x),3) for x in world],
                      "componentVolumeMl":round(voxels*voxel_ml,4),
                      "componentVoxels":voxels,
                      "fractureDiagnosisProven":False})
        if len(found)>128:raise ValueError("too_many_pelvis_components_to_report")
    return sorted(found,key=lambda c:c["componentVoxels"],reverse=True)


def expert_fragment_overlap(source: Path, prediction: Path, expert: Path):
    """Post-forward native ROI Dice and 26-connected one-to-one expert components."""
    import nibabel as nib
    import numpy as np
    from scipy import ndimage
    src=inspect_original_roi(source)
    for file in (prediction,expert):
        if file.is_symlink() or not file.is_file() or file.stat().st_size>MAX_SOURCE_BYTES:
            raise ValueError("invalid_expert_or_original_prediction")
    a,b=nib.load(str(prediction)),nib.load(str(expert))
    if any(img.ndim!=3 or img.shape!=src.shape or
           not np.allclose(img.affine,src.affine,atol=.02,rtol=0) or
           img.header.get_xyzt_units()[0]!=src.header.get_xyzt_units()[0]
           for img in (a,b)):
        raise ValueError("expert_prediction_not_original_native_roi_grid")
    predicted=np.asarray(a.dataobj)
    truth=np.asarray(b.dataobj)
    if (a.header.get_data_dtype().kind not in "iu" or
        b.header.get_data_dtype().kind not in "iu" or
        not np.isfinite(predicted).all() or
        not np.isin(truth,(0,1)).all() or
        not np.equal(predicted,np.rint(predicted)).all() or
        np.any(predicted<0) or np.any(predicted>30)):
        raise ValueError("unrecognized_expert_fragment_ontology")
    p=predicted>0
    e=truth==1
    if not e.any():raise ValueError("positive_expert_pelvic_fracture_reference_required")
    tp=int(np.count_nonzero(p&e))
    fp=int(np.count_nonzero(p&~e))
    fn=int(np.count_nonzero(~p&e))
    conn=ndimage.generate_binary_structure(3,3)
    pl,npred=ndimage.label(p,structure=conn)
    el,nexpert=ndimage.label(e,structure=conn)
    if npred>100000 or nexpert>100000:
        raise ValueError("excessive_fragment_component_count")
    sizes=np.bincount(pl.ravel(),minlength=npred+1)
    valid={i for i in range(1,npred+1) if sizes[i]>=10}
    overlaps=[]
    for i,sl in enumerate(ndimage.find_objects(pl),1):
        if sl is None or i not in valid:continue
        ids,counts=np.unique(el[sl][pl[sl]==i],return_counts=True)
        overlaps.extend((int(n),i,int(j)) for j,n in zip(ids,counts) if j)
    overlaps.sort(reverse=True)
    pm=set()
    em=set()
    for _,i,j in overlaps:
        if i not in pm and j not in em:
            pm.add(i);em.add(j)
    return {"originalExpertSHA256":sha256(expert),
            "expertFractureMaskVoxelCount":int(e.sum()),
            "voxelTP":tp,"voxelFP":fp,"voxelFN":fn,
            "oneRoiDice":round(2*tp/(2*tp+fp+fn),6),
            "expertComponents26":int(nexpert),
            "predictedComponents26AtLeast10Voxels":len(valid),
            "matchedExpertComponents":len(em),
            "missedExpertComponents":int(nexpert)-len(em),
            "unmatchedPredictedComponents":len(valid)-len(pm),
            "oneRoiComponentRecall":round(len(em)/nexpert,6),
            "expertAnnotationScopeMustMatchPrediction":True,
            "independentFROC":None,
            "clinicalSensitivity":None,
            "independentHeldOut":False}

def run(args):
    if (not args.approved_public_extracted_roi or
        not trusted_digest(args.source_sha256) or
        not args.isolated_gpu_research or
        not re.fullmatch(r"(?:Task[0-9]{3}_[A-Za-z0-9_]+|[0-9]{3})",args.task)):
        raise ValueError("approved_public_source_and_exact_original_vendor_task_required")
    source=inspect_original_roi(args.roi)
    if sha256(args.roi)!=args.source_sha256:raise ValueError("source_ROI_hash_changed")
    checkpoint=inspect_original_model(args.checkpoint,args.results,args.checkpoint_sha256)
    # The publisher documents >=10 GB VRAM and uses a patched nnUNet v1.7;
    # never run on macOS without NVIDIA, even with a misleading CLI flag.
    nvidia=shutil.which("nvidia-smi")
    if not nvidia:raise RuntimeError("isolated_10GB_NVIDIA_research_worker_required")
    gpu=subprocess.run([nvidia,"--query-gpu=memory.total",
                         "--format=csv,noheader,nounits"],capture_output=True,
                         text=True,timeout=12,check=True)
    sizes=[int(v.strip()) for v in gpu.stdout.splitlines() if v.strip().isdigit()]
    if not sizes or max(sizes)<10240:
        raise RuntimeError("original_FractureSegNet_requires_10GB_GPU")
    exe=shutil.which("nnUNet_predict")
    if not exe:raise RuntimeError("original_patched_nnunet_v1_7_predict_missing")
    args.output.mkdir(parents=True,exist_ok=True)
    if any(args.output.iterdir()):raise ValueError("isolated_output_directory_must_be_empty")
    with tempfile.TemporaryDirectory(prefix="opus-pelvic-fragments-") as work:
        inputs=Path(work)/"input"
        inputs.mkdir()
        shutil.copyfile(args.roi,inputs/"case_0000.nii.gz")
        env=os.environ.copy()
        env.update({"RESULTS_FOLDER":str(args.results.resolve()),
                    "OMP_NUM_THREADS":"2","OPENBLAS_NUM_THREADS":"1"})
        command=[exe,"-m","3d_fullres","-t",args.task,
                 "-f","all","-i",str(inputs),"-o",str(args.output.resolve()),
                 "--disable_tta"]
        subprocess.run(command,env=env,check=True,timeout=2700)
    pred=args.output/"case.nii.gz"
    if not pred.is_file():raise ValueError("real_vendor_FractureSegNet_output_absent")
    candidates=output_fragments(args.roi,pred)
    expert_scores=(expert_fragment_overlap(args.roi,pred,args.expert)
                   if args.expert is not None else None)
    return {"schema":SCHEMA,"task":"pelvic_fracture_fragment_CT",
            "publisher":AUTHOR,"modelFileSource":MODEL_SOURCE,
            "originalCheckpointSHA256":sha256(checkpoint),
            "originalSourceRoiSHA256":args.source_sha256,
            "predictedMaskSHA256":sha256(pred),
            "sourceShape":list(source.shape),"componentCandidates":candidates,
            "expertPositiveRoiComparison":expert_scores,
            "actualPublisherModelForwardCompleted":True,
            "nativeBoneRoiGeometryVerified":True,
            "fullPelvicCTAutomated":False,
            "clinicalFractureSensitivity":None,
            "patientUseApproved":False,"diagnosisPermitted":False,
            "publishedModelLicenseIndependentlyVerified":False,
            "gpuResource":"NVIDIA>=10GB isolated",
            "warning":"Only PRE-EXTRACTED bone ROIs; fracture fragments are not fracture-line detection"}


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--roi",type=Path,required=True)
    p.add_argument("--source-sha256",required=True)
    p.add_argument("--results",type=Path,required=True)
    p.add_argument("--task",required=True)
    p.add_argument("--checkpoint",type=Path,required=True)
    p.add_argument("--checkpoint-sha256",required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    p.add_argument("--expert",type=Path,help="Optional authentic positive binary expert fragment mask on the identical extracted bone ROI grid")
    p.add_argument("--approved-public-extracted-roi",action="store_true")
    p.add_argument("--isolated-gpu-research",action="store_true")
    args=p.parse_args()
    report=run(args)
    if args.report.exists():raise ValueError("numeric_result_must_be_new")
    args.report.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({"actualForward":True,"components":len(report["componentCandidates"]),
                      "clinicalFractureSensitivity":None}))


if __name__=="__main__":
    main()
