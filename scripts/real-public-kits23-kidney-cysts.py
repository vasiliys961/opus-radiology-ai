#!/usr/bin/env python3
"""Real pretrained kidney cyst model against ONE ORIGINAL public KiTS23 3D CT and expert cyst mask.

No synthetic segmentation; no training, LLM or app integration. KiTS23 CC BY-NC-SA
non-commercial research only. Vendor training overlap/clinical validity unverified.
Output is bounded numeric provenance/TP/FP/FN, not source pixels or clinical diagnosis.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

REPO="MedOtter/kits23"
CASE_IDS=(23,25,24,26,27,28)
MAX_BYTES=350*1024**2
MAX_VOXELS=512*512*700
SCHEMA="opus-real-public-kits23-kidney-cyst-comparison/v1"

def checksum(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def load_verified_pair(ct,expert,*,must_contain_cyst):
    import nibabel as nib
    import numpy as np
    for file in (ct,expert):
        if file.is_symlink() or not file.is_file() or not 500<=file.stat().st_size<=MAX_BYTES:
            raise ValueError("not_ordinary_bounded_public_source")
    image=nib.load(str(ct));truth=nib.load(str(expert))
    shape=image.shape
    scan_units=image.header.get_xyzt_units()[0]
    expert_units=truth.header.get_xyzt_units()[0]
    print(json.dumps({"sourceShape":list(shape),
         "expertShape":list(truth.shape),
         "sourceUnit":scan_units,"expertUnit":expert_units,
         "imageHeaderDatatype":str(image.header.get_data_dtype()),
         "expertHeaderDatatype":str(truth.header.get_data_dtype()),
         "maxAffineElementDelta":float(np.max(np.abs(image.affine-truth.affine)))}))
    # KiTS23 NIfTI axes are often (slices, row, column), not (x,y,slices).
    # Validate per-axis physical grid, not a preferred array-axis order.
    # Upstream files can omit NIfTI xyzt_unit: do NOT claim verified mm then.
    if (image.ndim!=3 or truth.ndim!=3 or
        shape!=truth.shape or len(shape)!=3 or
        min(shape)<8 or max(shape)>1059 or
        np.prod(shape)>MAX_VOXELS or
        scan_units not in ("mm","unknown") or
        expert_units!=scan_units or
        not np.isfinite(image.affine).all() or
        abs(np.linalg.det(image.affine[:3,:3]))<0.0001):
        raise ValueError("unsupported_original_kits23_image_geometry")
    for i in (0,shape[0]-1):
        for j in (0,shape[1]-1):
            for k in (0,shape[2]-1):
                point=np.array([i,j,k,1],dtype=float)
                if np.linalg.norm((image.affine@point)[:3]-(truth.affine@point)[:3])>0.05:
                    raise ValueError("kidney_expert_grid_not_native_ct_grid")
    if truth.header.get_data_dtype().kind not in ("u","i"):
        raise ValueError("expert_kits23_mask_not_integer")
    labels=np.asarray(truth.dataobj)
    if not np.isin(labels,(0,1,2,3)).all():
        raise ValueError("unrecognized_expert_kits23_label")
    counts=[int(np.count_nonzero(labels==c)) for c in range(4)]
    if must_contain_cyst and counts[3]==0:raise ValueError("expert_cyst_missing")
    return image,labels,counts

def fetch_case(folder):
    from huggingface_hub import HfApi,hf_hub_download
    import shutil
    import os
    if folder.exists():raise ValueError("research_output_must_be_new")
    info=HfApi(token=False).repo_info(REPO,repo_type="dataset",token=False)
    revision=info.sha
    if not isinstance(revision,str) or len(revision)!=40:
        raise ValueError("dataset_revision_not_immutable_SHA")
    folder.mkdir(mode=0o700)
    for case in CASE_IDS:
        case_name=f"case_{case:05d}"
        files={}
        for key,file in (("ct","imaging.nii.gz"),("expert","segmentation.nii.gz")):
            path=f"dataset/{case_name}/{file}"
            source=Path(hf_hub_download(repo_id=REPO,repo_type="dataset",
                       revision=revision,filename=path,token=False))
            target=folder/f"{key}.nii.gz"
            if target.exists():target.unlink()
            shutil.copyfile(source,target)
            files[key]=target
        try:
            image,labels,counts=load_verified_pair(files["ct"],files["expert"],must_contain_cyst=False)
        except Exception:
            for f in files.values():f.unlink(missing_ok=True)
            raise
        print(json.dumps({"caseCode":case_name,"expertLabelCounts":counts,
                          "hasExpertCyst":counts[3]>0}))
        if counts[3]>0:
            manifest={
                "schema":"opus-kits23-cc-by-nc-sa-research-admission/v1",
                "publicDataset":REPO,"datasetRevisionSha":revision,
                "caseCode":case_name,"officialSplit":"training",
                "datasetLicense":"CC BY-NC-SA 4.0",
                "fullSuppliedCTGeometryDimensions":list(image.shape),
                "sourceSha256":checksum(files["ct"]),
                "expertSha256":checksum(files["expert"]),
                "expertOriginalKidneyLabel1":counts[1],
                "expertOriginalTumorLabel2":counts[2],
                "expertOriginalCystLabel3":counts[3],
                "trainingHoldoutIndependentlyEstablished":False,
                "clinicalValidation":False}
            (folder/"manifest.json").write_text(json.dumps(manifest,indent=2))
            print(json.dumps({"realKiTS23CystPositiveStudyReady":True,
                              "caseCode":case_name,"shape":manifest["fullSuppliedCTGeometryDimensions"],
                              "expertCystVoxels":counts[3],
                              "sourceSha256":manifest["sourceSha256"]}))
            return
        for f in files.values():f.unlink(missing_ok=True)
    raise ValueError("no_cyst_positive_reference_in_bounded_candidate_selection")

def lesion_evidence(pred, truth, affine, *, spatial_mm_verified):
    """26-connected source-native cyst candidates; expert overlap is research only."""
    import numpy as np
    from scipy import ndimage
    if pred.shape != truth.shape or pred.ndim != 3:
        raise ValueError("source_native_lesion_grid_mismatch")
    structure=ndimage.generate_binary_structure(3,3)
    pred_labels,n_pred=ndimage.label(pred,structure=structure)
    gt_labels,n_gt=ndimage.label(truth,structure=structure)
    if max(n_pred,n_gt)>10000:
        raise ValueError("unbounded_cyst_component_count")
    boxes=ndimage.find_objects(pred_labels)
    candidates=[]
    matched=set()
    for ident,region in enumerate(boxes,1):
        if region is None:continue
        voxels=np.argwhere(pred_labels[region]==ident)
        if len(voxels)<3:continue
        offsets=np.array([r.start for r in region])
        centroid=voxels.mean(axis=0)+offsets
        gt_ids=np.unique(gt_labels[region][pred_labels[region]==ident])
        hits=[int(k) for k in gt_ids if k>0]
        matched.update(hits)
        world=(affine@np.r_[centroid,1])[:3]
        candidates.append({
          "sourceVoxelBoundsInclusive":[[int(r.start),int(r.stop-1)] for r in region],
          "centroidSourceIJK":[round(float(v),3) for v in centroid],
          "centroidWorldCoordinate":[round(float(v),3) for v in world],
          "worldCoordinateUnits":"mm" if spatial_mm_verified else "unverified",
          "predictedVoxels":int(len(voxels)),
          "overlapsExpertCyst":bool(hits),
          "expertComponentsOverlapped":len(hits),
          "cystDiagnosisProven":False,
        })
        if len(candidates)>512:
            raise ValueError("too_many_cyst_candidates")
    return {
      "expertConnectedCysts":int(n_gt),
      "predictedConnectedCystCandidatesMin3Voxels":len(candidates),
      "expertComponentsOverlappedByCandidates":len(matched),
      "oneSourceLesionRecall":round(len(matched)/n_gt,6) if n_gt else None,
      "candidateComponents":candidates,
      "independentValidation":False,
    }

def evaluate(folder,model_mask,weights,out):
    import numpy as np
    import nibabel as nib
    if out.exists() or out.is_symlink():raise ValueError("numeric_evidence_must_be_new")
    manifest=json.loads((folder/"manifest.json").read_text())
    wt=json.loads(weights.read_text())
    if (manifest.get("schema")!="opus-kits23-cc-by-nc-sa-research-admission/v1" or
        manifest.get("publicDataset")!=REPO or
        manifest.get("datasetLicense")!="CC BY-NC-SA 4.0" or
        manifest.get("trainingHoldoutIndependentlyEstablished") is not False or
        wt.get("modelTask")!="kidney_cysts" or
        wt.get("modelPackageVersion")!="2.18.0" or
        not isinstance(wt.get("checkpointSha256"),str) or
        len(wt["checkpointSha256"])!=64 or
        manifest.get("sourceSha256")!=checksum(folder/"ct.nii.gz") or
        manifest.get("expertSha256")!=checksum(folder/"expert.nii.gz")):
        raise ValueError("real_kits23_source_or_model_provenance_invalid")
    source,gt,counts=load_verified_pair(folder/"ct.nii.gz",folder/"expert.nii.gz",must_contain_cyst=True)
    if counts[3]!=manifest["expertOriginalCystLabel3"]:
        raise ValueError("expert_mask_changed")
    if (model_mask.is_symlink() or not model_mask.is_file() or
        model_mask.stat().st_size>MAX_BYTES):
        raise ValueError("real_kidney_cyst_model_mask_missing")
    result=nib.load(str(model_mask))
    source_units=source.header.get_xyzt_units()[0]
    mask_units=result.header.get_xyzt_units()[0]
    print(json.dumps({
        "trainedPredictionShape":list(result.shape),
        "originalShape":list(source.shape),
        "trainedPredictionUnit":mask_units,
        "originalUnit":source_units,
        "trainedPredictionDatatype":str(result.header.get_data_dtype()),
        "trainedPredictionMaxAffineDelta":float(np.max(np.abs(result.affine-source.affine)))}))
    # Original KiTS23 may omit the NIfTI spatial unit code. Reject
    # mismatches, but do not manufacture verified millimetres from unknown.
    if (result.ndim!=3 or result.shape!=source.shape or
        mask_units!=source_units or mask_units not in ("mm","unknown") or
        result.header.get_data_dtype().kind not in ("i","u","f")):
        raise ValueError("real_cyst_model_output_wrong_geometry_or_labels")
    for x in (0,source.shape[0]-1):
      for y in (0,source.shape[1]-1):
       for z in (0,source.shape[2]-1):
        point=np.array([x,y,z,1],dtype=float)
        if np.linalg.norm((source.affine@point)[:3]-(result.affine@point)[:3])>0.05:
            raise ValueError("real_cyst_mask_not_native_source_grid")
    model=np.asarray(result.dataobj)
    if not np.isin(model,(0,1,2)).all():
        raise ValueError("unexpected_kidney_cyst_model_labels")
    pred=(model==1)|(model==2)
    truth=(gt==3)
    tp=int(np.count_nonzero(pred&truth))
    fp=int(np.count_nonzero(pred&~truth))
    fn=int(np.count_nonzero(~pred&truth))
    kidneyWrong=int(np.count_nonzero(pred&(gt==1)))
    tumorWrong=int(np.count_nonzero(pred&(gt==2)))
    lesion=lesion_evidence(pred,truth,source.affine,\n        spatial_mm_verified=source.header.get_xyzt_units()[0]=="mm")\n    denom=2*tp+fp+fn
    report={
      "schema":SCHEMA,
      "task":"kidney_cysts",
      "model":"TotalSegmentator 2.18.0",
      "truePretrainedModelInferenceCompleted":True,
      "source":"KiTS23 original full public corticomedullary/nephrogenic CT",
      "datasetLicense":"CC BY-NC-SA 4.0 noncommercial research",
      "sourceRevisionSha":manifest["datasetRevisionSha"],
      "publicCaseCode":manifest["caseCode"],
      "sourceSha256":manifest["sourceSha256"],
      "originalExpertMaskSha256":manifest["expertSha256"],
      "modelMaskSha256":checksum(model_mask),
      "observedInstalledModelCheckpointSha256":wt["checkpointSha256"],
      "originalNativeSourceGridVerified":True,
      "sourceNiftiSpatialUnitMmVerified":source.header.get_xyzt_units()[0]=="mm",
      "originalDimensions":list(source.shape),
      "modelKidneyCystLeftLabel1Voxels":int(np.count_nonzero(model==1)),
      "modelKidneyCystRightLabel2Voxels":int(np.count_nonzero(model==2)),
      "expertRenalCystLabel3Voxels":counts[3],
      "expertTumorLabel2VoxelsNotCountedAsCyst":counts[2],
      "truePositiveCystVoxels":tp,"falsePositiveCystVoxels":fp,
      "falseNegativeCystVoxels":fn,
      "falseCystVoxelsInsideExpertTumor":tumorWrong,
      "falseCystVoxelsInsideExpertKidney":kidneyWrong,
      "oneSourceCystDice":round(2*tp/denom,6) if denom else None,
      "oneSourceCystVoxelRecall":round(tp/(tp+fn),6),
      "independentModelTrainingHoldout":False,
      "lesionLevelSensitivity":None,"singleCaseLesionEvidence":lesion,\n      "clinicalValidation":False,
      "noCystDiagnosisPermitted":False}
    out.write_text(json.dumps(report,indent=2))
    print(json.dumps({k:report[k] for k in
        ("task","expertRenalCystLabel3Voxels","truePositiveCystVoxels",
         "falsePositiveCystVoxels","falseNegativeCystVoxels",
         "falseCystVoxelsInsideExpertTumor","oneSourceCystDice",
         "clinicalValidation")}))
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","evaluate"),required=True)
    p.add_argument("--dir",type=Path,required=True)
    p.add_argument("--mask",type=Path)
    p.add_argument("--weights",type=Path)
    p.add_argument("--output",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":fetch_case(a.dir)
    elif a.mask and a.weights and a.output:evaluate(a.dir,a.mask,a.weights,a.output)
    else:raise ValueError("missing_real_model_or_evidence_arguments")
if __name__=="__main__":main()
