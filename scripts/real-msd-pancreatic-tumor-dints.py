#!/usr/bin/env python3
"""Real official MONAI DiNTS pancreas+tumor TorchScript on one original MSD CT.

Source labels are MSD Task07: 0=background, 1=pancreas, 2=tumor.
NOT an independent holdout: bundle trained on this dataset. Enforce official
preprocessing (RAS, 1mm spacing, [-87,199] HU -> [0,1]), then compare actual
pretrained mask on original native CT grid to expert label 2.

No trained weight loading via arbitrary torch.load/pickle. Research Linux only.
Never upload CT, tumor mask, or patient-derived voxel coordinates.
"""
from __future__ import annotations
import argparse, hashlib, json, math, time
from pathlib import Path

DATASET="MedOtter/msd-pancreas"
MODEL="MONAI/pancreas_ct_dints_segmentation"
MODEL_REVISION="989117c"
CASES=("391", "045", "061")
CASE_ROOT="data/nii/MSD/Task07_Pancreas"
SCHEMA="opus-real-original-ct-monai-pancreatic-tumor-v1"
MAX_ORIGINAL_SIZE=400*1024**2
MAX_VOXELS=150_000_000

def sha(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for buf in iter(lambda:stream.read(1024*1024),b""):h.update(buf)
    return h.hexdigest()

def verify_original(ct,expert):
    import nibabel as nib
    import numpy as np
    for f in (ct,expert):
        if f.is_symlink() or not f.is_file() or f.stat().st_size>MAX_ORIGINAL_SIZE:
            raise ValueError("not_bounded_original_msd_image")
    a=nib.load(str(ct)); b=nib.load(str(expert))
    if (a.ndim!=3 or b.ndim!=3 or a.shape!=b.shape or
        any(d<32 or d>700 for d in a.shape) or math.prod(a.shape)>MAX_VOXELS or
        a.header.get_xyzt_units()[0]!="mm" or
        b.header.get_xyzt_units()[0]!="mm" or
        b.header.get_data_dtype().kind not in ("u","i") or
        not np.isfinite(a.affine).all() or
        abs(float(np.linalg.det(a.affine[:3,:3])))<0.0001 or
        not np.allclose(a.affine,b.affine,atol=0.05,rtol=0)):
        raise ValueError("original_msd_ct_expert_grid_not_consistent")
    label=np.asarray(b.dataobj)
    if not np.isin(label,(0,1,2)).all():
        raise ValueError("unknown_original_MSD_pancreas_expert_labels")
    nums={str(i):int(np.count_nonzero(label==i)) for i in (0,1,2)}
    image=np.asarray(a.dataobj)
    if not np.isfinite(image).all() or float(image.min())>0 or float(image.max())<100:
        raise ValueError("original_CT_HU_signal_invalid")
    return a,nums

def prepare(folder):
    from huggingface_hub import HfApi,hf_hub_download
    import shutil
    if folder.exists():raise ValueError("ephemeral_directory_must_be_new")
    folder.mkdir(mode=0o700,parents=True)
    api=HfApi(token=False)
    dataset=api.repo_info(repo_id=DATASET,repo_type="dataset",token=False)
    model=api.model_info(repo_id=MODEL,revision=MODEL_REVISION,token=False)
    if (len(dataset.sha)!=40 or len(model.sha)!=40 or
        model.sha[:7]!=MODEL_REVISION or
        str(dataset.card_data.license).lower()!="cc-by-sa-4.0"):
        raise ValueError("source_model_version_or_dataset_license_not_verified")
    for case in CASES:
        name=f"pancreas_{case}.nii.gz"
        for key,category in (("ct","imagesTr"),("expert","labelsTr")):
            source=Path(hf_hub_download(repo_id=DATASET,repo_type="dataset",
                           revision=dataset.sha,filename=f"{category}/{name}",
                           token=False))
            if source.stat().st_size>MAX_ORIGINAL_SIZE:raise ValueError("oversize_MSD_CT")
            shutil.copyfile(source,folder/f"{key}.nii.gz")
        scan,counts=verify_original(folder/"ct.nii.gz",folder/"expert.nii.gz")
        print(json.dumps({"publicCaseCode":name,"expertPancreasVoxelCount":counts["1"],
                          "expertTumorVoxelCount":counts["2"]}))
        if counts["2"]>0:
            weights=Path(hf_hub_download(repo_id=MODEL,revision=model.sha,
                   filename="models/model.ts",token=False))
            if weights.stat().st_size<1024**2 or weights.stat().st_size>900*1024**2:
                raise ValueError("not_official_bounded_trained_model")
            shutil.copyfile(weights,folder/"official-model.ts")
            record={
                "schema":"opus-pancreas-monai-public-admission/v1",
                "dataset":DATASET,"datasetRevisionSha":dataset.sha,
                "datasetLicense":"cc-by-sa-4.0",
                "case":name,
                "sourceSha256":sha(folder/"ct.nii.gz"),
                "expertMaskSha256":sha(folder/"expert.nii.gz"),
                "model":MODEL,"modelRevisionSha":model.sha,
                "officialTrainedTorchScriptSha256":sha(folder/"official-model.ts"),
                "modelBundleVersion":"0.5.1",
                "originalCtShape":list(scan.shape),
                "originalExpertPancreasVoxels":counts["1"],
                "originalExpertTumorVoxels":counts["2"],
                "independentTrainingHoldout":False,
                "clinicalValidation":False}
            (folder/"admission.json").write_text(json.dumps(record,indent=2))
            print(json.dumps({"actualPublishedTrainedWeightsReady":True,
              "publishedModelRevisionSha":model.sha,"modelSha256":record["officialTrainedTorchScriptSha256"],
              "sourceSha256":record["sourceSha256"],"sourceSize":list(scan.shape)}))
            return
        (folder/"ct.nii.gz").unlink()
        (folder/"expert.nii.gz").unlink()
    raise ValueError("no_expert_tumor_positive_CTs_in_shortlist")

def tumor_components(label_mask, affine, minimum_voxels=10):
    """Localize trained tumor label 2 in ORIGINAL CT voxel coordinates.

    Components are candidates; not pancreatic cancer diagnoses and not a
    validated lesion-level detector. Multiple small foci may be suppressed.
    """
    import numpy as np
    from scipy import ndimage
    data=np.asarray(label_mask)
    a=np.asarray(affine,dtype=float)
    if (data.ndim!=3 or data.size>MAX_VOXELS or
        not np.isin(data,(0,1,2)).all() or a.shape!=(4,4) or
        not np.isfinite(a).all() or abs(np.linalg.det(a[:3,:3]))<1e-8):
        raise ValueError("not_original_native_pancreatic_tumor_label_grid")
    if not 1<=minimum_voxels<=100:
        raise ValueError("unsupported_minimum_lesion_component_size")
    objects,count=ndimage.label(data==2,structure=ndimage.generate_binary_structure(3,2))
    slices=ndimage.find_objects(objects)
    voxel_mm3=abs(float(np.linalg.det(a[:3,:3])))
    lesions=[]
    for label,sl in enumerate(slices,1):
        if sl is None:continue
        block=objects[sl]==label
        n=int(np.count_nonzero(block))
        if n<minimum_voxels:continue
        center=np.array(ndimage.center_of_mass(block))+[x.start for x in sl]
        world=(a@np.r_[center,1])[:3]
        lesions.append({
            "nativeSourceVoxelBoxIJK":[[int(x.start),int(x.stop-1)] for x in sl],
            "nativeSourceCentroidIJK":[round(float(x),3) for x in center],
            "sourceNiftiWorldCentroidMm":[round(float(x),3) for x in world],
            "candidateVoxelCount":n,"candidateVolumeMl":round(n*voxel_mm3/1000,4),
            "confirmedPancreaticCancer":False})
        if len(lesions)>128:
            raise ValueError("excessive_tumor_components_require_review")
    lesions.sort(key=lambda q:q["candidateVoxelCount"],reverse=True)
    return lesions

def infer(folder,out):
    import nibabel as nib
    import numpy as np
    import torch
    from monai.inferers import sliding_window_inference
    from nibabel.processing import resample_to_output, resample_from_to
    if out.exists() or out.is_symlink():raise ValueError("numeric_output_must_be_new")
    meta=json.loads((folder/"admission.json").read_text())
    if (meta.get("schema")!="opus-pancreas-monai-public-admission/v1" or
        meta.get("dataset")!=DATASET or
        meta.get("model")!=MODEL or
        meta.get("modelRevisionSha","")[:7]!=MODEL_REVISION or
        meta.get("independentTrainingHoldout") is not False or
        meta.get("sourceSha256")!=sha(folder/"ct.nii.gz") or
        meta.get("expertMaskSha256")!=sha(folder/"expert.nii.gz") or
        meta.get("officialTrainedTorchScriptSha256")!=sha(folder/"official-model.ts")):
        raise ValueError("original_public_source_or_trained_checkpoint_CHANGED")
    original,counts=verify_original(folder/"ct.nii.gz",folder/"expert.nii.gz")
    start=time.monotonic()
    # Nibabel RAS canonical orientation + 1 mm interpolation mirrors official
    # MONAI bundle's Orientationd(RAS) and Spacingd(1,1,1).
    canonical=nib.as_closest_canonical(original)
    resampled=resample_to_output(canonical,voxel_sizes=(1,1,1),order=1)
    if math.prod(resampled.shape)>MAX_VOXELS:raise ValueError("unbounded_1mm_RAS_volume")
    scan=np.asarray(resampled.dataobj,dtype=np.float32)
    scan=np.clip((scan+87.0)/286.0,0.0,1.0)
    torch.set_num_threads(2)
    model=torch.jit.load(str(folder/"official-model.ts"),map_location="cpu")
    model.eval()
    # Preserves the publisher's 96^3 ROI, while deliberately using a lower
    # overlap 0.25 (official bundle uses 0.625) to bound CPU runtime. This is
    # disclosed as an off-protocol research run, NOT model performance reproduction.
    with torch.inference_mode():
        tensor=torch.from_numpy(np.ascontiguousarray(scan[None,None]))
        output=sliding_window_inference(tensor,roi_size=(96,96,96),
            sw_batch_size=1,predictor=model,overlap=0.25,
            sw_device=torch.device("cpu"),device=torch.device("cpu"))
        if isinstance(output,(tuple,list)):output=output[0]
        if output.ndim!=5 or output.shape[1]!=3:
            raise ValueError("unexpected_original_three_class_DiNTS_model_output")
        prediction=output.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)
    del tensor,output,scan
    native_mask=nib.Nifti1Image(prediction,resampled.affine)
    native_prediction=resample_from_to(native_mask,original,order=0)
    native=np.asarray(native_prediction.dataobj,dtype=np.uint8)
    if native.shape!=original.shape or not np.isin(native,[0,1,2]).all():
        raise ValueError("prediction_not_registered_to_original_native_CT_grid")
    original_truth=nib.load(str(folder/"expert.nii.gz"))
    ground_truth=np.asarray(original_truth.dataobj)==2
    detected=native==2
    lesions=tumor_components(native,original.affine)
    tp=int(np.count_nonzero(ground_truth&detected))
    fp=int(np.count_nonzero(~ground_truth&detected))
    fn=int(np.count_nonzero(ground_truth&~detected))
    dice=2*tp/(2*tp+fp+fn)
    evidence={
       "schema":SCHEMA,"model":"MONAI published DiNTS pancreas_ct_dints_segmentation v0.5.1 TorchScript",
       "task":"pancreatic_tumor_CT",
       "source":"Medical Segmentation Decathlon Task07 Pancreas (public train split)",
       "sourceCase":meta["case"],"sourceRevisionSha":meta["datasetRevisionSha"],
       "sourceSha256":meta["sourceSha256"],"expertMaskSha256":meta["expertMaskSha256"],
       "genuineTrainedTorchScriptSha256":meta["officialTrainedTorchScriptSha256"],
       "officialTrainedInferenceCompleted":True,
       "preprocessing":"RAS 1mm, HU -87:199 scaled 0:1",
       "roiSizeVoxels":[96,96,96],
       "cpuOverlap":0.25,"publisherOverlap":0.625,
       "publisherInferenceProtocolReproducedExactly":False,
       "trainedPredictionMappedToOriginalCT":True,
       "nativeSourceDimensions":meta["originalCtShape"],
       "expertTumorVoxels":counts["2"],
       "predictedTumorVoxels":tp+fp,
       "tumorCandidateComponents":lesions,
       "tumorCandidateCount":len(lesions),
       "absenceOfCancerEstablished":False,
       "sourceNiftiCoordinatesNotDICOMLPS":True,
       "truePositiveTumorVoxels":tp,"falsePositiveTumorVoxels":fp,
       "falseNegativeTumorVoxels":fn,
       "oneStudyTumorDice":round(dice,6),
       "oneStudyVoxelTumorRecall":round(tp/(tp+fn),6),
       "oneStudyVoxelTumorPrecision":round(tp/(tp+fp),6) if tp+fp else None,
       "elapsedInferenceAndAuditSec":round(time.monotonic()-start,2),
       "independentModelTrainingHoldout":False,"clinicalValidation":False,
       "lesionLevelSensitivity":None,"commercialUseApproved":False,
       "limitations":[
         "MSD Task07 is the upstream training dataset of this model: no independent validation.",
         "CPU window overlap 0.25 differs from published 0.625: no benchmark equivalence.",
         "Single volume voxel Dice not a diagnosis or general clinical sensitivity.",
         "Neither weights nor example outputs are clinical products; licensing needs separate review."
       ]}
    out.write_text(json.dumps(evidence,indent=2))
    print(json.dumps({k:evidence[k] for k in (
       "task","expertTumorVoxels","predictedTumorVoxels",
       "truePositiveTumorVoxels","falsePositiveTumorVoxels",
       "falseNegativeTumorVoxels","oneStudyTumorDice",
       "elapsedInferenceAndAuditSec","clinicalValidation")}))
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","infer"),required=True)
    p.add_argument("--dir",type=Path,required=True)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":prepare(a.dir)
    elif a.output:infer(a.dir,a.output)
    else:raise ValueError("missing_numeric_evidence_output")
if __name__=="__main__":main()
