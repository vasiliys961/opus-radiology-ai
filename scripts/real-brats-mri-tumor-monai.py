#!/usr/bin/env python3
"""Genuine MONAI SegResNet pretrained BraTS tumor subregion segmentation on four real MRI.

Public BrainMVP BraTS2021 original four sequences and expert mask are downloaded
from immutable HF revision. Official MONAI/brats_mri_segmentation v0.5.3:
T1c, T1, T2, FLAIR; sigmoid channels TC/WT/ET. Pretrained checkpoint SHA fixed
to the published remote file digest, loaded with weights_only=True.
No source MRI or masks leave ephemeral CI; numeric evidence only. The BraTS
source data license must be reviewed beyond mirror metadata before redistribution.
"""
from __future__ import annotations
import argparse, hashlib, json, math, shutil, time
from pathlib import Path

DATASET="shaohao011/BrainMVP-16k"
MODEL="MONAI/brats_mri_segmentation"
MODEL_REF="6ea5b85"
MODEL_SHA="860ccb3f1c21c99d0410ad8a1ac4ef6b8fab60cec0a503b0ba42675741a750ae"
CASE="BraTS2021_00000"
PREFIX=f"BraTS2021/BraTS2021_Training_Data/{CASE}/{CASE}_"
SEQUENCES=("t1ce","t1","t2","flair")
OUTPUT_SCHEMA="opus-real-4sequence-brats-glioma-subregions-v1"

def digest(file):
    h=hashlib.sha256()
    with Path(file).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def validated_original(folder):
    import nibabel as nib
    import numpy as np
    paths={k:folder/f"{k}.nii.gz" for k in (*SEQUENCES,"seg")}
    imgs=[]
    for p in paths.values():
        if p.is_symlink() or not p.is_file() or not 500<=p.stat().st_size<=30*1024**2:
            raise ValueError("not_original_bounded_BraTS_nii")
    for k in SEQUENCES:imgs.append(nib.load(str(paths[k])))
    expert=nib.load(str(paths["seg"]))
    shape=expert.shape
    if (expert.ndim!=3 or math.prod(shape)>12_000_000 or
        shape!=(240,240,155) or
        expert.header.get_data_dtype().kind not in ("i","u") or
        not all(im.shape==shape for im in imgs)):
        raise ValueError("not_original_four_registered_BraTS_volumes")
    for im in imgs:
        if not all(abs(float(a)-float(b))<0.001 for a,b in zip(im.affine.flat,expert.affine.flat)):
            raise ValueError("four_input_sequences_or_expert_are_misaligned")
    for image in imgs:
        x=np.asarray(image.dataobj)
        if not np.isfinite(x).all() or float(x.max())<=0:
            raise ValueError("real_BraTS_MRI_signal_missing")
    labels=np.asarray(expert.dataobj)
    if not np.isin(labels,[0,1,2,4]).all() or not np.count_nonzero(labels):
        raise ValueError("positive_BraTS_expert_three_subregions_missing")
    counts={str(k):int(np.count_nonzero(labels==k)) for k in (1,2,4)}
    return imgs,labels,counts

def prepare(folder):
    from huggingface_hub import HfApi,hf_hub_download
    if folder.exists():raise ValueError("new_research_directory_required")
    folder.mkdir(mode=0o700,parents=True)
    api=HfApi(token=False)
    ds=api.repo_info(repo_id=DATASET,repo_type="dataset",token=False)
    official=api.model_info(repo_id=MODEL,revision=MODEL_REF,token=False)
    if (len(ds.sha)!=40 or len(official.sha)!=40 or
        official.sha[:7]!=MODEL_REF):
        raise ValueError("unverifiable_published_revisions")
    for key in (*SEQUENCES,"seg"):
        f=Path(hf_hub_download(repo_id=DATASET,repo_type="dataset",
              revision=ds.sha,filename=PREFIX+key+".nii.gz",token=False))
        if f.stat().st_size>30*1024**2:raise ValueError("BraTS_source_exceeds_public_bounded_size")
        shutil.copyfile(f,folder/f"{key}.nii.gz")
    original,gt,counts=validated_original(folder)
    w=Path(hf_hub_download(repo_id=MODEL,revision=official.sha,
                  filename="models/model.pt",token=False))
    if digest(w)!=MODEL_SHA:
        raise ValueError("publisher_model_checkpoint_sha256_changed")
    shutil.copyfile(w,folder/"official-model.pt")
    record={"schema":"opus-public-brats-four-sequence-admission/v1",
       "dataset":DATASET,"datasetRevisionSha":ds.sha,
       "datasetOriginalRights":"source BraTS data usage terms govern; mirror MIT label not used as license proof",
       "model":MODEL,"modelRevisionSha":official.sha,
       "modelCheckpointSha256":MODEL_SHA,
       "pretrainedModelUsesOriginalBraTS2018":True,
       "independentHoldoutVerified":False,
       "publicCaseCode":CASE,"nativeShape":list(original[0].shape),
       "nativeAffineVerifiedFor4SequencesAndExpert":True,
       "originalSequenceOrder":list(SEQUENCES),
       "originalSourceSha256":{k:digest(folder/f"{k}.nii.gz") for k in SEQUENCES},
       "originalExpertSha256":digest(folder/"seg.nii.gz"),
       "originalExpertSubregionVoxels":counts,
       "clinicalValidation":False}
    (folder/"admission.json").write_text(json.dumps(record,indent=2))
    print(json.dumps({"originalRealFourSequenceMRI":True,"studyShape":record["nativeShape"],
        "expertLabels":counts,"publishedTrainedCheckpointSha256":MODEL_SHA}))

def infer(folder,out):
    import numpy as np
    import torch
    from monai.networks.nets import SegResNet
    from monai.inferers import sliding_window_inference
    from monai.transforms import NormalizeIntensity
    if out.exists() or out.is_symlink():raise ValueError("numerical_evidence_not_new")
    r=json.loads((folder/"admission.json").read_text())
    if (r.get("schema")!="opus-public-brats-four-sequence-admission/v1" or
        r.get("model")!=MODEL or r.get("modelCheckpointSha256")!=MODEL_SHA or
        r.get("independentHoldoutVerified") is not False or
        digest(folder/"official-model.pt")!=MODEL_SHA or
        digest(folder/"seg.nii.gz")!=r["originalExpertSha256"] or
        any(digest(folder/f"{k}.nii.gz")!=r["originalSourceSha256"][k] for k in SEQUENCES)):
        raise ValueError("published_BraTS_source_or_model_changed")
    images,gt,counts=validated_original(folder)
    torch.set_num_threads(2)
    # Exactly the publisher's NormalizeIntensity(nonzero=True,channel_wise=True).
    volumes=np.stack([np.asarray(i.dataobj,dtype=np.float32) for i in images],axis=0)
    normalized=NormalizeIntensity(nonzero=True,channel_wise=True)(volumes)
    x=torch.from_numpy(np.ascontiguousarray(np.asarray(normalized)[None])).float()
    model=SegResNet(spatial_dims=3,init_filters=16,in_channels=4,out_channels=3,
                    dropout_prob=0.2,blocks_down=(1,2,2,4),blocks_up=(1,1,1))
    checkpoints=torch.load(folder/"official-model.pt",map_location="cpu",weights_only=True)
    state=checkpoints.get("model",checkpoints) if isinstance(checkpoints,dict) else None
    if not isinstance(state,dict):raise ValueError("not_official_Monai_3D_SegResNet_checkpoint")
    model.load_state_dict(state,strict=True)
    model.eval()
    start=time.monotonic()
    with torch.inference_mode():
        pred=sliding_window_inference(x,roi_size=(240,240,160),
               sw_batch_size=1,predictor=model,overlap=0.5,
               sw_device=torch.device("cpu"),device=torch.device("cpu"))
        if pred.shape[1]!=3:raise ValueError("not_Monai_TC_WT_ET_three_channel_model")
        probs=torch.sigmoid(pred)[0].cpu().numpy()
    truth={"tumorCore":np.isin(gt,[1,4]),"wholeTumor":np.isin(gt,[1,2,4]),
           "enhancingTumor":gt==4}
    result={}
    for name,ch in (("tumorCore",0),("wholeTumor",1),("enhancingTumor",2)):
        mask=probs[ch]>0.5
        expert=truth[name]
        tp=int(np.count_nonzero(mask&expert))
        fp=int(np.count_nonzero(mask&~expert))
        fn=int(np.count_nonzero(~mask&expert))
        result[name]={"expertVoxels":int(np.count_nonzero(expert)),
           "modelPositiveVoxels":tp+fp,"TP":tp,"FP":fp,"FN":fn,
           "singleVolumeDice":round(2*tp/(2*tp+fp+fn),6) if tp+fp+fn else None}
    report={
       "schema":OUTPUT_SCHEMA,
       "model":"MONAI official pretrained brats_mri_segmentation v0.5.3",
       "modelRevision":r["modelRevisionSha"],"checkpointSha256":MODEL_SHA,
       "trueOriginalPretrained4ChannelInference":True,
       "source":DATASET,"sourceDatasetRevision":r["datasetRevisionSha"],
       "originalBraTSCase":CASE,"sourceSHA":r["originalSourceSha256"],
       "expertMaskSHA":r["originalExpertSha256"],
       "inputOriginalModalities":list(SEQUENCES),
       "predictionAlignedWithExpertOriginalNativeGrid":True,
       "threshold":0.5,"oneVolumeSubregionComparisons":result,
       "elapsedSec":round(time.monotonic()-start,2),
       "independentTrainingHoldout":False,
       "clinicalValidation":False,"patientDiagnosisAllowed":False,
       "limitations":[
          "The publisher model was trained on BraTS2018; overlap with this BraTS2021 public case has not been independently excluded.",
          "One volume Dice on tumor subregion masks is NOT tumor detection sensitivity or clinical generalization.",
          "BraTS source data rights must be validated from primary organizer; the HF mirror's MIT label alone is insufficient.",
          "Preprocessed, pre-registered four modality BraTS input cannot prove performance on routine unregistered clinical sequences."
       ]}
    out.write_text(json.dumps(report,indent=2))
    print(json.dumps({"schema":OUTPUT_SCHEMA,"task":"brain_glioma_MRI_4sequence",
       "subregions":result,"clinicalValidation":False}))
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","infer"),required=True)
    p.add_argument("--dir",required=True,type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":prepare(a.dir)
    elif a.output:infer(a.dir,a.output)
    else:raise ValueError("no_numeric_audit_output")
if __name__=="__main__":main()
