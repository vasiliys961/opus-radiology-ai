#!/usr/bin/env python3
"""Real *pretrained* pulmonary embolism segmentation on public FUMPE CTPA.

Vendor published Mazurowski Lab / yzluka ResidualEncoderUNet weights, licensed
CC-BY-NC 4.0 (research only). A single pinned original public FUMPE full CT
and matching expert binary mask are downloaded by immutable HF revision;
run original portable preprocessing/model in separate job, compare native voxels.

Output: numeric TP, FP, FN and Dice only; no patient image or voxel coordinates.
Zero prediction MUST still be reported, never reinterpreted as negative diagnosis.
This is one case, not clinical validation or an established independent holdout.
"""
from __future__ import annotations
import argparse,hashlib,json,math,os,shutil
from pathlib import Path
DATASET="MedOtter/FUMPE"
MODEL="yzluka/PulmonaryEmbolismSegmentation"
MODEL_REF="7ce235f"
SOURCE_COMMIT_PREFIX="5d78690"
CASES=("PAT001","PAT002","PAT003")
SCHEMA="opus-real-public-ctpa-fumpe-embolism-expert-comparison/v1"

def sha(p):
    h=hashlib.sha256()
    with Path(p).open("rb") as fd:
        for b in iter(lambda:fd.read(2*1024*1024),b""):h.update(b)
    return h.hexdigest()

def native_pair(root):
    import nibabel as nib
    import numpy as np
    ct=root/"ct.nii.gz"
    ref=root/"expert.nii.gz"
    for p in (ct,ref):
        if p.is_symlink() or not p.is_file() or not 100<=p.stat().st_size<=280*1024**2:
            raise ValueError("original_FUMPE_source_missing_or_unbounded")
    image=nib.load(str(ct)); mask=nib.load(str(ref))
    shape=image.shape
    if (image.ndim!=3 or mask.ndim!=3 or shape!=mask.shape or
        any(not 16<=v<=800 for v in shape) or
        math.prod(shape)>145_000_000 or
        mask.header.get_data_dtype().kind not in ("u","i") or
        not np.isfinite(image.affine).all() or
        abs(float(np.linalg.det(image.affine[:3,:3])))<0.00001):
        raise ValueError("unaligned_original_FUMPE_CTPA")
    for x in (0,shape[0]-1):
      for y in (0,shape[1]-1):
       for z in (0,shape[2]-1):
        pt=np.array([x,y,z,1.],dtype=float)
        if np.linalg.norm((image.affine@pt)[:3]-(mask.affine@pt)[:3])>0.05:
            raise ValueError("expert_PE_mask_not_native_CTPA_geometry")
    labels=np.asarray(mask.dataobj)
    if not np.isin(labels,[0,1]).all():
        raise ValueError("FUMPE_expert_PE_labels_not_binary")
    n=int(np.count_nonzero(labels))
    signal=np.asarray(image.dataobj)
    if not np.isfinite(signal).all() or float(signal.max())<100 or float(signal.min())>0:
        raise ValueError("non_CT_like_original_FUMPE_intensities")
    spacing=[float(v) for v in image.header.get_zooms()[:3]]
    if any(not 0.2<=v<=8.0 for v in spacing):
        raise ValueError("not_valid_CTPA_axis_spacing")
    return image,n,spacing

def prepare(root):
    from huggingface_hub import HfApi,hf_hub_download
    if root.exists():raise ValueError("original_public_case_directory_must_be_new")
    api=HfApi(token=False)
    ds=api.repo_info(repo_id=DATASET,repo_type="dataset",revision=SOURCE_COMMIT_PREFIX,token=False)
    mdl=api.model_info(repo_id=MODEL,revision=MODEL_REF,token=False)
    if (not isinstance(ds.sha,str) or len(ds.sha)!=40 or
        not ds.sha.startswith(SOURCE_COMMIT_PREFIX) or
        not isinstance(mdl.sha,str) or len(mdl.sha)!=40 or
        not mdl.sha.startswith(MODEL_REF)):
        raise ValueError("public_original_dataset_or_official_checkpoint_revision_not_pinned")
    root.mkdir(mode=0o700,parents=True)
    for case in CASES:
        for local,folder in (("ct","images"),("expert","masks")):
            downloaded=Path(hf_hub_download(repo_id=DATASET,repo_type="dataset",
                            filename=f"{folder}/{case}.nii.gz",revision=ds.sha,token=False))
            if downloaded.stat().st_size>280*1024**2:
                raise ValueError("oversize_original_FUMPE_CTPA")
            shutil.copyfile(downloaded,root/f"{local}.nii.gz")
        ct,n,spacing=native_pair(root)
        print(json.dumps({"case":case,"actualExpertPulmonaryEmbolusVoxels":n,
                          "dimensions":list(ct.shape)}))
        if n:
            manifest={
             "schema":"opus-FUMPE-original-CTPA-expert-admission/v1",
             "originalDataset":DATASET,"datasetSourceRevisionSha":ds.sha,
             "originalCase":case,"originalDatasetLicense":"cc-by-4.0",
             "actualPretrainedModel":MODEL,"modelRevisionSha":mdl.sha,
             "modelLicense":"cc-by-nc-4.0 research only",
             "nativeShape":list(ct.shape),"originalAxisSpacing":spacing,
             "CTPASha256":sha(root/"ct.nii.gz"),
             "expertPEmaskSha256":sha(root/"expert.nii.gz"),
             "expertPEmaskPositiveVoxels":n,
             "sourcePhysicalGridCornerVerified":True,
             "expertIndependentOfModelTrainingProven":False,
             "clinicalValidation":False}
            (root/"manifest.json").write_text(json.dumps(manifest,indent=2))
            print(json.dumps({"FUMPE_OriginalPositiveExpertReady":True,
               "case":case,"expertEmbolusVoxels":n,"sourceSHA":manifest["CTPASha256"],
               "checkpointRevision":mdl.sha}))
            return
        for path in (root/"ct.nii.gz",root/"expert.nii.gz"):
            path.unlink(missing_ok=True)
    raise ValueError("no_positive_expert_PE_mask_in_first_three_public_cases")

def evaluate(root,output_segmentation,checkpoint_meta,out):
    import nibabel as nib
    import numpy as np
    if out.exists() or out.is_symlink():raise ValueError("numeric_research_result_must_be_new")
    m=json.loads((root/"manifest.json").read_text())
    c=json.loads(checkpoint_meta.read_text())
    if (m.get("schema")!="opus-FUMPE-original-CTPA-expert-admission/v1" or
        m.get("originalDataset")!=DATASET or
        m.get("originalDatasetLicense")!="cc-by-4.0" or
        m.get("modelLicense")!="cc-by-nc-4.0 research only" or
        not m.get("modelRevisionSha","").startswith(MODEL_REF) or
        m.get("expertIndependentOfModelTrainingProven") is not False or
        m.get("CTPASha256")!=sha(root/"ct.nii.gz") or
        m.get("expertPEmaskSha256")!=sha(root/"expert.nii.gz") or
        c.get("sourceModelRevision")!=m["modelRevisionSha"] or
        not isinstance(c.get("publishedModelBinSha256"),str) or
        len(c["publishedModelBinSha256"])!=64):
        raise ValueError("real_FUMPE_or_pretrained_model_provenance_failed")
    image,n,spacing=native_pair(root)
    if (n!=m["expertPEmaskPositiveVoxels"] or
        list(image.shape)!=m["nativeShape"]):
        raise ValueError("original_reference_mask_changed")
    if (not output_segmentation.is_file() or output_segmentation.is_symlink() or
        output_segmentation.stat().st_size>250*1024**2):
        raise ValueError("genuine_trained_model_output_missing")
    with np.load(str(output_segmentation),allow_pickle=False) as saved:
        if saved.files!=["segmentation"]:
            raise ValueError("expected_vendor_real_pretrained_segmentation_npz")
        model_zyx=np.asarray(saved["segmentation"])
    # Mazurowski source run_inference.py explicitly transposes NIfTI XYZ->ZYX.
    prediction=np.moveaxis(model_zyx,(0,1,2),(2,1,0))
    if (prediction.shape!=image.shape or
        not np.isin(prediction,[0,1]).all()):
        raise ValueError("pretrained_model_output_not_in_original_CTPA_native_voxel_grid")
    gt=np.asarray(nib.load(str(root/"expert.nii.gz")).dataobj)==1
    mask=prediction==1
    # True original model/expert native masks, not image-level classification.
    from pe_lesion_native_metrics import score_pe_components
    lesion_metrics=score_pe_components(gt,mask,image.affine)
    tp=int(np.count_nonzero(gt&mask))
    fp=int(np.count_nonzero(~gt&mask))
    fn=int(np.count_nonzero(gt&~mask))
    result={
      "schema":SCHEMA,"task":"pulmonary_embolism_ctpa_segmentation",
      "trainedModel":"Mazurowski Lab genuine pretrained pulmonary embolism ResidualEncoderUNet",
      "modelRevisionSha":m["modelRevisionSha"],"observedOfficialWeightSha256":c["publishedModelBinSha256"],
      "modelLicense":"CC BY-NC 4.0 - research only",
      "dataset":"FUMPE 35 public CTPAs, dual-radiologist expert mask",
      "datasetOriginalLicense":"CC BY 4.0",
      "originalPublicCase":m["originalCase"],
      "sourceSha256":m["CTPASha256"],"expertMaskSha256":m["expertPEmaskSha256"],
      "trainedModelMaskSha256":sha(output_segmentation),
      "originalFullVolumeShape":m["nativeShape"],
      "actualFull3DTrainedInferenceCompleted":True,
      "vendorVoxelAxisPermutationInverted":True,
      "expertEmbolismVoxels":n,"predictedEmbolismVoxels":tp+fp,
      "truePositiveEmbolismVoxels":tp,"falsePositiveEmbolismVoxels":fp,
      "falseNegativeEmbolismVoxels":fn,
      "oneVolumeEmbolusDice":round(2*tp/(2*tp+fp+fn),6),
      "oneVolumeEmbolusVoxelRecall":round(tp/n,6),
      "oneVolumeEmbolusVoxelPrecision":round(tp/(tp+fp),6) if tp+fp else None,
      "lesionLevelSensitivity":lesion_metrics["singleStudyComponentRecall"],"specificity":None,
      "independentTrainingHoldout":False,"clinicalValidation":False,
      "patientDiagnosisAllowed":False,
      **lesion_metrics,
      "limitations":[
        "One FUMPE source. Exclusion of FUMPE from vendor training has not been independently established.",
        "Small CPU tile may differ in boundary behavior from released full patch setting.",
        "Single positive case, voxel Dice and 3D lesion recall do not establish general sensitivity, specificity or deployable accuracy.",
        "Publisher checkpoint licensed CC BY-NC 4.0; commercial clinical use not authorized.",
        "FUMPE rehosted files require primary-source provenance review before clinical interpretation."
      ]}
    out.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result[k] for k in (
      "task","expertEmbolismVoxels","predictedEmbolismVoxels",
      "truePositiveEmbolismVoxels","falsePositiveEmbolismVoxels",
      "falseNegativeEmbolismVoxels","oneVolumeEmbolusDice",
      "clinicalValidation")}))
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","evaluate"),required=True)
    p.add_argument("--dir",type=Path,required=True)
    p.add_argument("--prediction",type=Path)
    p.add_argument("--checkpoint",type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":prepare(a.dir)
    elif a.prediction and a.checkpoint and a.output:evaluate(a.dir,a.prediction,a.checkpoint,a.output)
    else:raise ValueError("expected_real_pretrained_model_and_prediction")
if __name__=="__main__":main()
