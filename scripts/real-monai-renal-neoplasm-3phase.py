#!/usr/bin/env python3
"""Original MONAI renalStructures_CECT_segmentation neoplasm channel 4.

Real task-specific original pretrained 3-phase renal-neoplasm CT segmentation.
ONLY three mutually registered, kidney-cropped arterial/venous/excretory NIfTI
volumes. Original official model.pt validated by publisher MD5, no patient cloud.
Inference is CPU research and NOT a patient cancer diagnosis.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

SOURCE="https://github.com/Project-MONAI/model-zoo/tree/dev/models/renalStructures_CECT_segmentation"
CHECKPOINT_MD5="164752169d98459d30592d72a3fa86f4"
EXPECTED_CLASS=4
PHASES=("artery","vein","excret")
MAX_VOXELS=24_000_000
MAX_FILE=400*1024**2


def digest(path,kind="sha256"):
    h=hashlib.new(kind)
    with path.open("rb") as file:
        for piece in iter(lambda:file.read(1024*1024),b""):
            h.update(piece)
    return h.hexdigest()


def source_grid(paths):
    import nibabel as nib
    import numpy as np
    if set(paths)!=set(PHASES):
        raise ValueError("exactly_three_arterial_venous_excretory_CTs_required")
    imgs={}
    for key in PHASES:
        f=paths[key]
        if (f.is_symlink() or not f.is_file() or not f.name.endswith(".nii.gz")
            or not 1024<=f.stat().st_size<=MAX_FILE):
            raise ValueError("missing_or_unbounded_original_registered_phase")
        im=nib.load(str(f))
        if (im.ndim!=3 or min(im.shape)<20 or math.prod(im.shape)>MAX_VOXELS
            or im.header.get_xyzt_units()[0]!="mm" or
            not np.isfinite(im.affine).all() or
            abs(np.linalg.det(im.affine[:3,:3]))<.001):
            raise ValueError("three_phase_source_not_valid_bounded_kidney_ROI")
        imgs[key]=im
    base=imgs["artery"]
    for name in PHASES[1:]:
        if (imgs[name].shape!=base.shape or
            not np.allclose(imgs[name].affine,base.affine,atol=.02,rtol=0)):
            raise ValueError("all_three_original_CT_phases_must_be_registered")
    return imgs


def original_checkpoint(file:Path):
    if (file.is_symlink() or not file.is_file() or
        file.name!="model.pt" or not 1024**2<file.stat().st_size<1024**3):
        raise ValueError("original_sechenov_renal_neoplasm_model_pt_required")
    if digest(file,"md5")!=CHECKPOINT_MD5:
        raise ValueError("official_MONAI_renal_CECT_model_MD5_mismatch")
    return {"checkpointSHA256":digest(file),"officialModelMD5":CHECKPOINT_MD5,
            "publisherSource":SOURCE}


def kidney_tumor_candidates(mask,affine,minimum_voxels=10):
    import numpy as np
    from scipy import ndimage
    data=np.asarray(mask)
    a=np.asarray(affine,dtype=float)
    if (data.ndim!=3 or data.size>MAX_VOXELS or not np.isin(data,[0,1]).all()
        or a.shape!=(4,4) or not np.isfinite(a).all() or
        abs(np.linalg.det(a[:3,:3]))<.001):
        raise ValueError("invalid_native_renal_neoplasm_binary_mask")
    regions,n=ndimage.label(data==1,structure=ndimage.generate_binary_structure(3,2))
    found=[]
    volume=abs(float(np.linalg.det(a[:3,:3])))/1000
    for idx,box in enumerate(ndimage.find_objects(regions),1):
        if box is None:continue
        subset=regions[box]==idx
        count=int(np.count_nonzero(subset))
        if count<minimum_voxels:continue
        c=np.asarray(ndimage.center_of_mass(subset))+[s.start for s in box]
        w=(a@np.r_[c,1])[:3]
        found.append({"sourceVoxelBox":[[int(s.start),int(s.stop-1)] for s in box],
                      "sourceVoxelCentroid":[round(float(v),3) for v in c],
                      "niftiWorldCentroidMm":[round(float(v),3) for v in w],
                      "candidateVolumeMl":round(count*volume,4),
                      "candidateVoxels":count,
                      "renalCancerProven":False})
        if len(found)>128:raise ValueError("excessive_tumor_components")
    return sorted(found,key=lambda x:x["candidateVoxels"],reverse=True)


def inference(args):
    import nibabel as nib
    import numpy as np
    import torch
    from monai.networks.nets import SegResNet
    from monai.inferers import sliding_window_inference
    from monai.transforms import Compose, LoadImaged, EnsureChannelFirstd, Orientationd, Spacingd, ScaleIntensityRanged
    from nibabel.processing import resample_from_to

    if not args.approved_public_three_phase_ROI or not args.isolated_research_worker:
        raise ValueError("registered_public_three_phase_research_authorization_required")
    paths={"artery":args.artery,"vein":args.vein,"excret":args.excretory}
    originals=source_grid(paths)
    info=original_checkpoint(args.checkpoint)
    if (args.report.exists() or args.out_mask.exists() or
        not args.report.parent.is_dir() or not args.out_mask.parent.is_dir()):
        raise ValueError("new_local_output_destinations_required")
    transform=Compose([
        LoadImaged(keys=list(PHASES),image_only=False),
        EnsureChannelFirstd(keys=list(PHASES)),
        Orientationd(keys=list(PHASES),axcodes="LPS"),
        Spacingd(keys=list(PHASES),pixdim=(.8,.8,.8),mode="bilinear"),
        ScaleIntensityRanged(keys=list(PHASES),a_min=-1000,a_max=1000,
                             b_min=0,b_max=1,clip=True)])
    d=transform({k:str(paths[k]) for k in PHASES})
    shape=tuple(d["artery"].shape[1:])
    if (any(tuple(d[k].shape[1:])!=shape for k in PHASES) or
        math.prod(shape)>MAX_VOXELS):
        raise ValueError("publisher_registered_phase_resampling_too_large")
    data=torch.cat([d[k].as_tensor().float() for k in PHASES],dim=0)[None]
    torch.set_num_threads(2)
    model=SegResNet(spatial_dims=3,in_channels=3,out_channels=6,init_filters=32,
                    upsample_mode="deconv",dropout_prob=.2,norm_name="group",
                    blocks_down=(1,2,2,4),blocks_up=(1,1,1))
    state=torch.load(str(args.checkpoint),map_location="cpu",weights_only=True)
    if not isinstance(state,dict) or not isinstance(state.get("model"),dict):
        raise ValueError("not_original_MONAI_bundle_model_state_dict")
    model.load_state_dict(state["model"],strict=True)
    model.eval()
    with torch.inference_mode():
        output=sliding_window_inference(data,(96,96,96),1,model,
                                         overlap=.25,sw_device="cpu",device="cpu")
        if output.ndim!=5 or output.shape[1]!=6:
            raise ValueError("not_original_six_channel_renal_CECT_logits")
        # Publisher: sigmoid + threshold 0.5, raw channel 4 = neoplasm.
        lesion=(torch.sigmoid(output[0,EXPECTED_CLASS])>.5).byte().numpy()
    low=nib.Nifti1Image(lesion,np.asarray(d["artery"].affine,dtype=float))
    original=originals["artery"]
    native=resample_from_to(low,original,order=0)
    arr=np.asarray(native.dataobj,dtype=np.uint8)
    if arr.shape!=original.shape or not np.isin(arr,[0,1]).all():
        raise ValueError("neoplasm_mask_not_registered_to_original_arterial_CT")
    out=nib.Nifti1Image(arr,original.affine,original.header.copy())
    out.header.set_data_dtype("uint8")
    nib.save(out,str(args.out_mask))
    comps=kidney_tumor_candidates(arr,original.affine)
    report={"schema":"opus-original-MONAI-renal-CECT-neoplasm-3phase/v1",
            "task":"renal_neoplasm", "model":SOURCE,
            "checkpointSHA256":info["checkpointSHA256"],
            "officialCheckpointMD5":CHECKPOINT_MD5,
            "phaseSHA256":{k:digest(paths[k]) for k in PHASES},
            "sourceNativeShape":list(original.shape),
            "predictionMaskSHA256":digest(args.out_mask),
            "neoplasmModelOutputChannel":EXPECTED_CLASS,
            "publisherLabel":"neoplasm",
            "threeRegisteredPhasesUsed":True,
            "publisherLPS080mmPreprocessing":True,
            "originalPretrainedInferenceCompleted":True,
            "sourceGridVerified":True, "componentCandidates":comps,
            "clinicallyValidated":False,"patientUseAllowed":False,
            "negativeCancerDiagnosis":False,
            "independentHoldout":False,
            "researchWarning":"Three kidney-cropped registered phases are mandatory. No CT single phase, no patient cancer diagnosis."}
    if args.expert:
        expert=nib.load(str(args.expert))
        if expert.shape!=original.shape or not np.allclose(expert.affine,original.affine,atol=.02,rtol=0):
            raise ValueError("renal_expert_tumor_mask_not_native_source_grid")
        gt=np.asarray(expert.dataobj)
        if not np.isin(gt,[0,1]).all():
            raise ValueError("expert_binary_neoplasm_mask_required")
        tp=int(np.count_nonzero((arr==1)&(gt==1)))
        fp=int(np.count_nonzero((arr==1)&(gt==0)))
        fn=int(np.count_nonzero((arr==0)&(gt==1)))
        report.update({"TP":tp,"FP":fp,"FN":fn,
                       "singleCaseVoxelDice":2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else None})
    else:
        report["singleCaseVoxelDice"]=None
    args.report.write_text(json.dumps(report,indent=2)+"\n")
    return report


def main():
    p=argparse.ArgumentParser()
    for phase in ("artery","vein","excretory"):
        p.add_argument("--"+phase,type=Path,required=True)
    p.add_argument("--checkpoint",type=Path,required=True)
    p.add_argument("--out-mask",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    p.add_argument("--expert",type=Path)
    p.add_argument("--approved-public-three-phase-ROI",action="store_true")
    p.add_argument("--isolated-research-worker",action="store_true")
    x=inference(p.parse_args())
    print(json.dumps({"originalForward":x["originalPretrainedInferenceCompleted"],
                      "candidateCount":len(x["componentCandidates"]),
                      "clinicalValidation":False}))


if __name__=="__main__":
    main()
