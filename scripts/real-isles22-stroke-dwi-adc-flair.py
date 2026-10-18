#!/usr/bin/env python3
"""Research-only real pretrained ISLES'22 3-sequence ischemic lesion segmentation.

Requires ORIGINAL licensed public DWI, ADC, FLAIR, expert ischemic-lesion mask
and official public author's nnU-Net v2 fold0 pretrained checkpoint; full native
source-space expert Dice (not clinical validation nor independent holdout).
No fake MRI, no source data/masks or voxel coordinates uploaded as artifacts.
"""
from __future__ import annotations
import argparse,hashlib,json,math,shutil
from pathlib import Path
DS="shaohao011/BrainMVP-ds"
WEIGHTS="akifkaradag/isles22-nnunetv2-stroke-segmentation"
CASE="sub-strokecase0032"
SESSION="ses-0001"
ROOT=f"ISLES2022/ISLES2022-Training/{CASE}_{SESSION}"
LABEL=f"{ROOT}/{CASE}_{SESSION}_msk.nii.gz"
SCHEMA="opus-real-isles22-pretrained-ischemic-stroke-expert-mask/v1"

def sha(f):
    h=hashlib.sha256()
    with Path(f).open("rb") as fp:
        for chunk in iter(lambda:fp.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def read_pair(path):
    import nibabel as nib
    import numpy as np
    from nibabel.processing import resample_from_to
    dwi=nib.load(str(path/"dwi.nii.gz"))
    expert=nib.load(str(path/"expert.nii.gz"))
    if (dwi.ndim!=3 or expert.ndim!=3 or
        dwi.shape!=expert.shape or
        math.prod(dwi.shape)>14_000_000 or
        min(dwi.shape)<10 or
        not np.isfinite(dwi.affine).all() or
        abs(float(np.linalg.det(dwi.affine[:3,:3])))<0.00001 or
        not np.allclose(dwi.affine,expert.affine,rtol=0,atol=0.1)):
        raise ValueError("DWI_and_expert_original_native_geometry_invalid")
    mask=np.asarray(expert.dataobj)
    if not np.isin(mask,[0,1]).all() or not np.count_nonzero(mask):
        raise ValueError("expert_positive_ischemic_mask_missing")
    return dwi,int(np.count_nonzero(mask))

def prepare(path):
    from huggingface_hub import HfApi,hf_hub_download,snapshot_download
    import nibabel as nib
    import numpy as np
    from nibabel.processing import resample_from_to
    if path.exists():raise ValueError("new_public_ischemia_work_dir_required")
    ds=HfApi(token=False).repo_info(repo_id=DS,repo_type="dataset",token=False)
    model=HfApi(token=False).model_info(repo_id=WEIGHTS,token=False)
    if len(ds.sha)!=40 or len(model.sha)!=40:raise ValueError("unverifiable_original_public_MRI_or_weights_revision")
    path.mkdir(mode=0o700,parents=True)
    for name in ("dwi","adc","flair"):
        source=f"{ROOT}/{CASE}_{SESSION}_{name.upper() if name=='flair' else name}.nii.gz"
        f=Path(hf_hub_download(repo_id=DS,repo_type="dataset",revision=ds.sha,
                               filename=source,token=False))
        if f.stat().st_size>80*1024**2:raise ValueError("oversize_public_ischemia_MRI")
        shutil.copyfile(f,path/f"{name}.nii.gz")
    f=Path(hf_hub_download(repo_id=DS,repo_type="dataset",revision=ds.sha,
                           filename=LABEL,token=False))
    shutil.copyfile(f,path/"expert.nii.gz")
    dwi,positive=read_pair(path)
    original_sha={name:sha(path/f"{name}.nii.gz") for name in ("dwi","adc","flair")}
    # Real DWI, ADC, FLAIR can differ in voxel grid: the model expects jointly
    # resampled channels and a single DWI source grid.
    for idx,name in enumerate(("dwi","adc","flair")):
        original=nib.load(str(path/f"{name}.nii.gz"))
        if original.ndim!=3 or not np.isfinite(original.affine).all():
            raise ValueError("invalid_original_MR_sequence")
        array=np.asarray(original.dataobj,dtype=np.float32)
        if not np.isfinite(array).all() or float(array.max())<=float(array.min()):
            raise ValueError("public_MRI_sequence_contains_no_real_signal")
        if original.shape!=dwi.shape or not np.allclose(original.affine,dwi.affine,atol=0.001,rtol=0):
            original=resample_from_to(original,dwi,order=1)
        nib.save(nib.Nifti1Image(np.asarray(original.dataobj,dtype=np.float32),dwi.affine),
                 str(path/f"stroke_000{idx}.nii.gz"))
    folder=Path(snapshot_download(repo_id=WEIGHTS,revision=model.sha,
          local_dir=path/"original-pretrained-weights",allow_patterns=[
          "dataset.json","plans.json","fold_0/*","*/dataset.json","*/plans.json","*/fold_0/*",
          "*/*/dataset.json","*/*/plans.json","*/*/fold_0/*"],token=False,max_workers=2))
    options=[p.parent for p in folder.rglob("plans.json") if
             (p.parent/"dataset.json").is_file() and
             (p.parent/"fold_0/checkpoint_best.pth").is_file()]
    if not options:raise ValueError("official_trained_stroke_model_checkpoint_layout_unavailable")
    model_folder=sorted(options,key=lambda q:len(str(q)))[0]
    checkpoint=model_folder/"fold_0/checkpoint_best.pth"
    if not 1*1024**2<checkpoint.stat().st_size<950*1024**2:
        raise ValueError("pretrained_stroke_checkpoint_missing_or_unbounded")
    meta={
      "schema":"opus-ISLES22-original-research-admission/v1",
      "originalSourceDataset":DS,"sourceCommit":ds.sha,
      "study":CASE,"originalModality":["DWI","ADC","FLAIR"],
      "sourceSequenceSha256":original_sha,"expertMaskSha256":sha(path/"expert.nii.gz"),
      "sourceGeometry":list(dwi.shape),"expertIschemicLesionVoxels":positive,
      "trainedModel":WEIGHTS,"modelCommit":model.sha,
      "originalFold0CheckpointSha256":sha(checkpoint),
      "relativePretrainedModelFolder":str(model_folder.relative_to(path)),
      "independentVendorTrainingHoldoutVerified":False,
      "clinicalValidation":False}
    (path/"admission.json").write_text(json.dumps(meta,indent=2))
    print(json.dumps({"public3sequenceIschemiaAndExpertVerified":True,
                       "study":CASE,"actualExpertVoxels":positive,
                       "originalDimensions":list(dwi.shape),
                       "checkpointSha256":meta["originalFold0CheckpointSha256"]}))

def evaluate(path,prediction,out):
    import numpy as np
    import nibabel as nib
    if out.exists() or out.is_symlink():raise ValueError("numeric_result_must_be_new")
    m=json.loads((path/"admission.json").read_text())
    if (m.get("schema")!="opus-ISLES22-original-research-admission/v1" or
        m.get("originalSourceDataset")!=DS or
        m.get("trainedModel")!=WEIGHTS or
        m.get("independentVendorTrainingHoldoutVerified") is not False or
        any(sha(path/f"{n}.nii.gz")!=m["sourceSequenceSha256"][n] for n in ("dwi","adc","flair")) or
        sha(path/"expert.nii.gz")!=m["expertMaskSha256"] or
        sha(path/m["relativePretrainedModelFolder"]/"fold_0/checkpoint_best.pth")!=m["originalFold0CheckpointSha256"]):
        raise ValueError("actual_original_ischemia_image_or_trained_model_provenance_changed")
    dwi,n=read_pair(path)
    if n!=m["expertIschemicLesionVoxels"]:raise ValueError("original_MRI_expert_data_changed")
    if prediction.is_symlink() or not prediction.is_file():raise ValueError("actual_nnUNet_prediction_missing")
    actual=nib.load(str(prediction))
    if actual.shape!=dwi.shape or not np.allclose(actual.affine,dwi.affine,rtol=0,atol=0.1):
        raise ValueError("trained_ischemia_mask_not_native_registered")
    x=np.asarray(actual.dataobj)
    if not np.isin(x,[0,1]).all():raise ValueError("nnUNet_pretrained_mask_not_binary_ischemia")
    y=np.asarray(nib.load(str(path/"expert.nii.gz")).dataobj)==1
    pred=x==1
    tp=int(np.count_nonzero(y&pred))
    fp=int(np.count_nonzero(~y&pred))
    fn=int(np.count_nonzero(y&~pred))
    result={
     "schema":SCHEMA,"task":"ischemic_stroke_DWI_ADC_FLAIR",
     "model":"Author pretrained ISLES22 nnU-Net v2 3D fullres fold0",
     "sourceStudy":CASE,"originalSourceCommit":m["sourceCommit"],
     "trainedModelCommit":m["modelCommit"],
     "observedActualCheckpointSha256":m["originalFold0CheckpointSha256"],
     "originalMRISha256":m["sourceSequenceSha256"],"expertMaskSha256":m["expertMaskSha256"],
     "trainedPredictionSha256":sha(prediction),
     "nativeSourceShape":m["sourceGeometry"],"pretrainedModelExecuted":True,
     "expertIschemicMaskVoxels":n,"predictedIschemicMaskVoxels":tp+fp,
     "truePositiveVoxels":tp,"falsePositiveVoxels":fp,"falseNegativeVoxels":fn,
     "oneScanIschemicDice":round(2*tp/(2*tp+fp+fn),6),
     "oneScanVoxelRecall":round(tp/n,6),
     "lesionLevelSensitivity":None,"clinicalValidation":False,
     "independentVendorTrainingHoldoutVerified":False,
     "limitations":[
       "Original public ISLES22 source used for upstream training; no independent external holdout.",
       "One public DWI/ADC/FLAIR case does not prove clinical stroke detection.",
       "External model checkpoint loaded in isolated public-only researcher worker, no private source.",
       "No patient diagnosis or deployment is allowed before further validation."
     ]}
    out.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result[k] for k in ("task","expertIschemicMaskVoxels",
     "predictedIschemicMaskVoxels","truePositiveVoxels","falsePositiveVoxels",
     "falseNegativeVoxels","oneScanIschemicDice","clinicalValidation")}))
def run_real_pretrained_model(root,output_dir):
    """Separate script process needed for nnU-Net multiprocessing spawn."""
    import shutil
    import torch
    from nnunetv2.inference.predict_from_raw_data import nnUNetPredictor
    record=json.loads((root/"admission.json").read_text())
    weights=root/record["relativePretrainedModelFolder"]
    checkpoint=weights/"fold_0/checkpoint_best.pth"
    if (not checkpoint.is_file() or
        sha(checkpoint)!=record["originalFold0CheckpointSha256"]):
        raise ValueError("original_pretrained_ischemic_stroke_checkpoint_changed")
    images=root/"nnunet-prediction-input"
    if images.exists():raise ValueError("clean_model_input_directory_required")
    images.mkdir(mode=0o700)
    for i in range(3):
        file=root/("stroke_000"+str(i)+".nii.gz")
        if not file.is_file():raise ValueError("original_registered_stroke_MR_channel_missing")
        shutil.copy2(file,images/file.name)
    if output_dir.exists():raise ValueError("new_model_output_directory_required")
    output_dir.mkdir(mode=0o700,parents=True)
    predictor=nnUNetPredictor(tile_step_size=0.8,use_gaussian=True,
         use_mirroring=False,perform_everything_on_device=False,
         device=torch.device("cpu"),verbose=False,
         verbose_preprocessing=False,allow_tqdm=False)
    predictor.initialize_from_trained_model_folder(str(weights),
         use_folds=(0,),checkpoint_name="checkpoint_best.pth")
    predictor.predict_from_files(str(images),str(output_dir),
         save_probabilities=False,overwrite=True,
         num_processes_preprocessing=1,num_processes_segmentation_export=1)
    if not (output_dir/"stroke.nii.gz").is_file():
        raise ValueError("original_pretrained_nnUNet_did_not_produce_binary_ischemic_stroke_mask")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","infer","evaluate"),required=True)
    p.add_argument("--dir",type=Path,required=True)
    p.add_argument("--prediction",type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":prepare(a.dir)
    elif a.mode=="infer" and a.output:run_real_pretrained_model(a.dir,a.output)
    elif a.mode=="evaluate" and a.prediction and a.output:evaluate(a.dir,a.prediction,a.output)
    else:raise ValueError("real_trained_prediction_required")
if __name__=="__main__":main()
