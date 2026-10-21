#!/usr/bin/env python3
"""Research-only genuine spinal myeloma VMI40 nnU-Net inference + expert voxels.

Runs the actual publisher v1.0.2 Python pipeline with locally installed original
Zenodo checkpoints; never simulates network predictions or infers on plain CT.
Public TCIA VMI40 + corresponding ConvCT + independent lesion mask supplied by
researcher; all checked on native voxel grid before/after real model execution.
This must run on a separate >=12GiB NVIDIA GPU, NOT user's 8GB Mac.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

SCHEMA="opus-original-spinal-myeloma-vmi40-expert-v1"
ZENODO="https://zenodo.org/records/18598645"
TCIA="https://doi.org/10.7937/k4qv-hh78"
PUBLISHER="MISAG-BUT/Spinal-Multiple-Myeloma-SEG"
PUBLISHER_TAG="v1.0.2"
PUBLISHER_COMMIT="502978885a765b6aa5db9da345bf2c3855bc73f6"
OFFICIAL_SCRIPT_BLOB="f48a665f1fcb8c891ca9d79304d9a4d1c89654ce"
OFFICIAL_MODEL_ZIP_MD5="02f72a4c4bf8c34790b36400db7cc6d1"
SPINE_DATASET="Dataset802_Spine_segmentation_trained_on_VerSe20_and_MM_dataset_together"
LESION_DATASET="Dataset710_MM_Lesion_seg_just_VMI_40"
MAX_VOXELS=150_000_000
MAX_FILE_BYTES=500*1024**2

def digest(path:Path,algorithm:str="sha256")->str:
    h=hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(2*1024**2),b""):
            h.update(block)
    return h.hexdigest()

def git_blob_sha(path:Path)->str:
    size=path.stat().st_size
    h=hashlib.sha1()
    h.update(b"blob "+str(size).encode("ascii")+b"\0")
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(1024**2),b""):
            h.update(block)
    return h.hexdigest()

def bounded(path:Path):
    if path.is_symlink() or not path.is_file() or not 1024<=path.stat().st_size<=MAX_FILE_BYTES:
        raise ValueError("public_CT_or_reference_missing_or_unbounded")

def verify_source(conv:Path,vmi40:Path,expert:Path):
    import nibabel as nib
    import numpy as np
    for path in (conv,vmi40,expert):
        bounded(path)
    images=[nib.load(str(p)) for p in (conv,vmi40,expert)]
    base=images[1]
    if (any(im.ndim!=3 or im.shape!=base.shape for im in images) or
        math.prod(base.shape)>MAX_VOXELS or min(base.shape)<32 or
        any(not np.isfinite(im.affine).all() for im in images) or
        abs(float(np.linalg.det(base.affine[:3,:3])))<1e-5 or
        any(not np.allclose(im.affine,base.affine,atol=0.05,rtol=0) for im in images) or
        any(im.header.get_xyzt_units()[0]!="mm" for im in images)):
        raise ValueError("ConvCT_VMI40_expert_do_not_share_full_native_mm_geometry")
    if not np.isfinite(np.asarray(base.dataobj)).all() or not np.isfinite(np.asarray(images[0].dataobj)).all():
        raise ValueError("CT_contains_nonfinite_voxels")
    if images[2].header.get_data_dtype().kind not in "ui":
        raise ValueError("expert_original_lesion_mask_not_integer")
    mask=np.asarray(images[2].dataobj)
    if not np.isin(mask,(0,1)).all():
        raise ValueError("original_expert_lesion_mask_not_binary")
    expert_count=int(np.count_nonzero(mask))
    if expert_count==0:
        raise ValueError("positive_expert_osteolytic_lesion_reference_required")
    return base, expert_count

def inspect_models(root:Path):
    """Refuse ordinary vertebra-only segmenters as a myeloma detector."""
    if root.is_symlink() or not root.is_dir():
        raise ValueError("unpacked_original_Zenodo_pretrained_models_required")
    selected={}
    for dataset in (SPINE_DATASET,LESION_DATASET):
        possibilities=[p for p in root.rglob(dataset) if p.is_dir()]
        if len(possibilities)!=1:
            raise ValueError("expected_exact_original_Zenodo_spine_and_VMI40_lesion_checkpoints")
        network=possibilities[0]/"nnUNetTrainer__nnUNetPlans__3d_fullres"
        model_info=network/"dataset.json"
        plans=network/"plans.json"
        if not all(p.is_file() and not p.is_symlink() for p in (model_info,plans)):
            raise ValueError("original_nnUNet_dataset_configuration_missing")
        cfg=json.loads(model_info.read_text())
        channels=cfg.get("channel_names",{})
        if dataset==LESION_DATASET:
            # In paper MM lesion segmentation always uses VMI40 plus vertebral mask.
            if not isinstance(channels,dict) or len(channels)!=2:
                raise ValueError("VMI40_model_must_include_spine_mask_channel")
        folds=[p for p in network.iterdir() if p.is_dir() and p.name.startswith("fold_")]
        checkpoints=[]
        for f in folds:
            checkpoint=f/"checkpoint_final.pth"
            if not checkpoint.is_file():
                checkpoint=f/"checkpoint_best.pth"
            if checkpoint.is_symlink() or not checkpoint.is_file() or not 1024**2<checkpoint.stat().st_size<900*1024**2:
                continue
            checkpoints.append(checkpoint)
        if not checkpoints:
            raise ValueError("real_original_nnUNet_trained_weights_not_found")
        # Original publisher pipeline asks for fold='all'.
        if not any(p.parent.name=="fold_all" for p in checkpoints):
            raise ValueError("original_publisher_fold_all_checkpoint_required")
        selected[dataset]={
            "datasetConfigurationSha256":digest(model_info),
            "plansSha256":digest(plans),
            "trainedCheckpointSha256":{p.relative_to(root).as_posix():digest(p) for p in checkpoints}
        }
    return selected

def evaluate_arrays(pred,expert):
    import numpy as np
    if pred.shape!=expert.shape or not np.isin(pred,(0,1)).all() or not np.isin(expert,(0,1)).all():
        raise ValueError("unmatched_or_nonbinary_real_MM_lesion_grid")
    model=pred==1
    gt=expert==1
    return (int(np.count_nonzero(model&gt)),
            int(np.count_nonzero(model&~gt)),
            int(np.count_nonzero(~model&gt)))

def lesion_matching(pred,expert,minimum_pred_voxels=5):
    """One-to-one 26-connected overlap; never a validated lesion FROC."""
    import numpy as np
    from scipy import ndimage
    p=np.asarray(pred)
    e=np.asarray(expert)
    if (p.shape!=e.shape or p.ndim!=3 or p.size>MAX_VOXELS
            or not np.isin(p,(0,1)).all() or not np.isin(e,(0,1)).all()
            or not 1<=minimum_pred_voxels<=100):
        raise ValueError("invalid_source_grid_osteolytic_instance_labels")
    structure=ndimage.generate_binary_structure(3,3)
    pl,pn=ndimage.label(p==1,structure)
    el,en=ndimage.label(e==1,structure)
    if pn>100000 or en>100000:
        raise ValueError("unbounded_osteolytic_instance_count")
    sizes=np.bincount(pl.ravel(),minlength=pn+1)
    valid={i for i in range(1,pn+1) if sizes[i]>=minimum_pred_voxels}
    pairs=[]
    for i,sl in enumerate(ndimage.find_objects(pl),1):
        if sl is None or i not in valid:continue
        ids,counts=np.unique(el[sl][pl[sl]==i],return_counts=True)
        pairs.extend((int(n),i,int(j)) for j,n in zip(ids,counts) if j)
    pairs.sort(reverse=True)
    taken_pred=set()
    taken_expert=set()
    for _,i,j in pairs:
        if i not in taken_pred and j not in taken_expert:
            taken_pred.add(i)
            taken_expert.add(j)
    return {
        "expertLesionComponents":int(en),
        "predictedLesionComponents":len(valid),
        "matchedExpertComponents":len(taken_expert),
        "missedExpertComponents":int(en)-len(taken_expert),
        "unmatchedPredictedComponents":len(valid)-len(taken_pred),
        "onePublicCaseLesionRecall":round(len(taken_expert)/en,6) if en else None,
        "connectivity":26,"minimumPredictedVoxels":minimum_pred_voxels,
        "matching":"greedy descending overlap, one-to-one",
        "independentFROC":None,"clinicalValidation":False}

def prepare(a):
    root=a.work
    if root.exists() or root.is_symlink():
        raise ValueError("fresh_output_directory_only")
    image,expert_count=verify_source(a.convct,a.vmi40,a.expert)
    script=a.vendor/"run_prediction_of_nnUNet_networks_on_new_data.py"
    if not script.is_file() or script.is_symlink() or git_blob_sha(script)!=OFFICIAL_SCRIPT_BLOB:
        raise ValueError("original_publisher_v1_0_2_script_not_git_blob_verified")
    if not (a.vendor/"utils.py").is_file() or not (a.vendor/"config.py").is_file():
        raise ValueError("original_publisher_preprocessing_package_missing")
    if a.model_zip is not None:
        if a.model_zip.is_symlink() or not a.model_zip.is_file() or a.model_zip.stat().st_size<3*1024**3:
            raise ValueError("original_3_7GB_Zenodo_archive_not_supplied")
        if digest(a.model_zip,"md5")!=OFFICIAL_MODEL_ZIP_MD5:
            raise ValueError("not_original_Zenodo_publisher_zip_checksum")
    hashes=inspect_models(a.models)
    root.mkdir(mode=0o700,parents=True)
    m={
        "schema":"opus-spinal-myeloma-author-pretrained-admission/v1",
        "dataset":TCIA,"sourceLicense":"CC BY 4.0",
        "publishedModel":ZENODO,"modelCode":PUBLISHER,
        "modelCodeReleaseTag":PUBLISHER_TAG,"modelCodeGitCommit":PUBLISHER_COMMIT,
        "authorScriptGitBlob":OFFICIAL_SCRIPT_BLOB,
        "originalModelArchiveMd5":OFFICIAL_MODEL_ZIP_MD5 if a.model_zip else None,
        "originalModelArchiveHashVerified":a.model_zip is not None,
        "models":hashes,
        "originalConvCtSha256":digest(a.convct),
        "originalVmi40Sha256":digest(a.vmi40),
        "originalExpertMaskSha256":digest(a.expert),
        "originalSourceShape":list(image.shape),
        "expertLesionVoxels":expert_count,
        "imagingProtocol":"DUAL ENERGY CT: ConvCT plus VMI 40 keV",
        "independentTrainingHoldoutVerified":False,
        "clinicalValidation":False,"patientUseAllowed":False,
        "weightsLicenseStatus":"research-only; independent commercial authorization unverified"}
    (root/"admission.json").write_text(json.dumps(m,indent=2))
    print(json.dumps({"realPublishedMyelomaWeightsLocated":True,
                      "expertOsteolyticVoxels":expert_count,"nativeShape":list(image.shape),
                      "checkpointCount":sum(len(x["trainedCheckpointSha256"]) for x in hashes.values()),
                      "actualInferenceRun":False}))

def admitted(a):
    m=json.loads((a.work/"admission.json").read_text())
    if (m.get("schema")!="opus-spinal-myeloma-author-pretrained-admission/v1"
            or m.get("originalConvCtSha256")!=digest(a.convct)
            or m.get("originalVmi40Sha256")!=digest(a.vmi40)
            or m.get("originalExpertMaskSha256")!=digest(a.expert)
            or m.get("authorScriptGitBlob")!=OFFICIAL_SCRIPT_BLOB
            or inspect_models(a.models)!=m.get("models")
            or git_blob_sha(a.vendor/"run_prediction_of_nnUNet_networks_on_new_data.py")!=OFFICIAL_SCRIPT_BLOB
            or m.get("patientUseAllowed") is not False):
        raise ValueError("public_CT_expert_or_original_nnUNet_model_hash_changed")
    return m

def run(a):
    import torch
    if not torch.cuda.is_available() or torch.cuda.get_device_properties(0).total_memory<12*1024**3:
        raise RuntimeError("original_MM_full_3D_requires_separate_CUDA_GPU_12_GiB_minimum")
    m=admitted(a)
    out=a.work/"publisher_outputs"
    if out.exists():raise ValueError("publisher_outputs_must_be_new")
    out.mkdir()
    begin=time.monotonic()
    env=os.environ.copy()
    env["HF_HUB_OFFLINE"]="1"
    env["HF_HUB_DISABLE_TELEMETRY"]="1"
    env["OMP_NUM_THREADS"]="2"
    subprocess.run([
        sys.executable,str((a.vendor/"run_prediction_of_nnUNet_networks_on_new_data.py").resolve()),
        "--path_to_convCT_nifti",str(a.convct.resolve()),
        "--path_to_VMI40_nifti",str(a.vmi40.resolve()),
        "--path_to_output_folder",str(out.resolve()),
        "--path_to_nnunet_results",str(a.models.resolve()),
        "--split","True"],
        cwd=a.vendor,env=env,check=True,timeout=10800)
    masks=list(out.glob("*/Segmentation/Lesion_segmentation_final/*.nii.gz"))
    if len(masks)!=1 or masks[0].is_symlink():
        raise ValueError("publisher_model_no_unique_real_native_lesion_mask")
    record={"schema":"opus-MM-actual-author-model-inference/v1",
            "originalVmi40Sha256":m["originalVmi40Sha256"],
            "originalConvCtSha256":m["originalConvCtSha256"],
            "checkpointHashes":m["models"],
            "predictionRel":masks[0].relative_to(a.work).as_posix(),
            "predictionSha256":digest(masks[0]),
            "seconds":round(time.monotonic()-begin,2),
            "authorPretrainedInferenceCompleted":True}
    (a.work/"execution.json").write_text(json.dumps(record,indent=2))

def evaluate(a):
    import nibabel as nib
    import numpy as np
    from scipy import ndimage
    m=admitted(a)
    o=a.output
    if o is None or o.is_symlink() or o.exists():
        raise ValueError("new_explicit_numeric_research_report_required")
    run_meta=json.loads((a.work/"execution.json").read_text())
    rel=run_meta.get("predictionRel")
    if (run_meta.get("schema")!="opus-MM-actual-author-model-inference/v1"
            or run_meta.get("authorPretrainedInferenceCompleted") is not True
            or run_meta.get("originalVmi40Sha256")!=m["originalVmi40Sha256"]
            or run_meta.get("originalConvCtSha256")!=m["originalConvCtSha256"]
            or run_meta.get("checkpointHashes")!=m["models"]
            or not isinstance(rel,str) or not rel.startswith("publisher_outputs/")):
        raise ValueError("trained_model_run_provenance_missing")
    prediction=(a.work/rel).resolve()
    if not prediction.is_relative_to((a.work/"publisher_outputs").resolve()):
        raise ValueError("prediction_outside_isolated_publisher_workdir")
    bounded(prediction)
    if digest(prediction)!=run_meta["predictionSha256"]:
        raise ValueError("original_vendor_prediction_changed")
    source,n=verify_source(a.convct,a.vmi40,a.expert)
    actual=nib.load(str(prediction))
    if (actual.ndim!=3 or actual.shape!=source.shape or
            not np.isfinite(actual.affine).all() or
            not np.allclose(actual.affine,source.affine,atol=0.05,rtol=0)):
        raise ValueError("MM_prediction_not_aligned_to_original_VMI40")
    x=np.asarray(actual.dataobj)
    y=np.asarray(nib.load(str(a.expert)).dataobj)
    if not np.isfinite(x).all() or not np.equal(x,np.rint(x)).all():
        raise ValueError("not_binary_original_model_output")
    tp,fp,fn=evaluate_arrays(x,y)
    lesion_metrics=lesion_matching(x,y)
    if tp+fn!=n:
        raise ValueError("expert_reference_changed")
    components,n_components=ndimage.label(x==1,structure=np.ones((3,3,3)))
    boxes=[]
    for i,sl in enumerate(ndimage.find_objects(components),1):
        if sl is None:continue
        volume=int(np.count_nonzero(components[sl]==i))
        if volume<5:continue
        boxes.append({"voxels":volume,"nativeVoxelBBoxXYZ":[[int(t.start),int(t.stop-1)] for t in sl]})
    boxes.sort(key=lambda x:x["voxels"],reverse=True)
    result={
        "schema":SCHEMA,"task":"osteolytic_spinal_multiple_myeloma_VMI40_CT",
        "model":"Original publisher nnU-Net 3D fullres VMI40 lesion checkpoint",
        "modelRecord":ZENODO,"weightsCheckpoints":m["models"],
        "originalVmi40Sha256":m["originalVmi40Sha256"],
        "originalConvCtSha256":m["originalConvCtSha256"],
        "expertMaskSha256":m["originalExpertMaskSha256"],
        "realPredictionSha256":run_meta["predictionSha256"],
        "originalSourceDimensionsXYZ":list(source.shape),"trueExpertOsteolyticVoxels":n,
        "predictedOsteolyticVoxels":tp+fp,"TP":tp,"FP":fp,"FN":fn,
        "voxelDice":round(2*tp/(2*tp+fp+fn),6) if tp+fp+fn else None,
        "voxelRecall":round(tp/n,6),"lesionVoxelCandidates":boxes[:100],
        "expertOsteolyticLesionMatching":lesion_metrics,
        "trainedInferenceObserved":True,"sourceBoundNativeNifti":True,
        "DicomSopMapped":False,"independentHeldOut":False,"clinicalValidation":False,
        "patientUseAllowed":False,
        "limitations":["Original 40-keV dual-energy CT required, ordinary CT unsupported.",
                       "Original TCIA cases contributed to model development; independent testing unverified.",
                       "No DICOM SOP/Frame-of-Reference mapping or clinical patient validation.",
                       "Published pretrained checkpoint used only in isolated research; license clearance for deployment not established."]}
    o.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result[k] for k in
                      ("task","trueExpertOsteolyticVoxels","predictedOsteolyticVoxels","TP","FP","FN","voxelDice","clinicalValidation")}))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",required=True,choices=["prepare","run","evaluate","all"])
    p.add_argument("--work",type=Path,required=True)
    p.add_argument("--convct",type=Path,required=True)
    p.add_argument("--vmi40",type=Path,required=True)
    p.add_argument("--expert",type=Path,required=True)
    p.add_argument("--vendor",type=Path,required=True)
    p.add_argument("--models",type=Path,required=True)
    p.add_argument("--model-zip",type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    if a.mode in ("prepare","all"):prepare(a)
    if a.mode in ("run","all"):run(a)
    if a.mode in ("evaluate","all"):evaluate(a)

if __name__=="__main__":main()
