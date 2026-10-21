#!/usr/bin/env python3
"""FIRST REAL liver lesion detector: pinned public MSD Liver original CT and expert lesion mask.

Downloads exactly ONE rights-cleared original image/expert mask pair from
a fixed Hugging Face repository revision. Compares real pretrained output from
independent TotalSegmentator task liver_lesions against expert label 2.

Research only. Held-out training independence UNVERIFIED. A single-case Dice
must never be advertised as general clinical sensitivity or diagnostic accuracy.
No pixels or mask bytes in numeric artifacts; all stay ephemeral.
"""
from __future__ import annotations
import argparse, hashlib, json, math, shutil, sys
from pathlib import Path

DATASET="MedOtter/msd-liver"
REV_PREFIX="6a5aad7"
CASE="liver_25.nii.gz"
EXPERT_SHA="0b8e5317450242d166a9cfe735c96eaa7c7a594d2315ab1d483ecf47ba1b9fa8"
LIMIT_COMPRESSED=512*1024**2
MAX_VOXELS=512*512*650

def sha(path:Path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def inspect_pair(source:Path,expert:Path):
    import nibabel as nib
    import numpy as np
    for path in (source,expert):
        if not path.is_file() or path.is_symlink() or not 512<=path.stat().st_size<=LIMIT_COMPRESSED:
            raise ValueError("invalid_bounded_original_msd_file")
    a,b=nib.load(str(source)),nib.load(str(expert))
    shape=a.shape
    if (a.ndim!=3 or b.ndim!=3 or shape!=b.shape or
        shape[0]>512 or shape[1]>512 or shape[2]>650 or
        shape[0]<32 or shape[1]<32 or shape[2]<32 or
        math.prod(shape)>MAX_VOXELS or
        a.header.get_xyzt_units()[0]!="mm" or
        b.header.get_xyzt_units()[0]!="mm"):
        raise ValueError("unbounded_original_ct_or_expert_geometry")
    m=np.asarray(a.affine,dtype=float)
    n=np.asarray(b.affine,dtype=float)
    if (not np.isfinite(m).all() or not np.isfinite(n).all() or
        abs(np.linalg.det(m[:3,:3]))<1e-5 or
        not np.allclose(m,n,atol=0.05,rtol=0)):
        raise ValueError("original_msd_expert_grid_not_equal")
    label=np.asarray(b.dataobj)
    if not np.isin(label,[0,1,2]).all():
        raise ValueError("unrecognized_msd_expert_label")
    tumor=int(np.count_nonzero(label==2))
    if not tumor:raise ValueError("selected_public_msd_ct_has_no_expert_tumor")
    x=np.asarray(a.dataobj)
    finite=np.isfinite(x)
    if (not finite.all() or
        not -32768<=float(x.min())<=float(x.max())<=32767 or
        not (float(np.percentile(x,1))<0<float(np.percentile(x,99)))):
        raise ValueError("unverified_original_ct_hu_values")
    return {"shape":list(shape),"expertTumorVoxels":tumor,
            "expertLiverVoxels":int(np.count_nonzero(label==1)),
            "voxVolumeMm3":abs(float(np.linalg.det(m[:3,:3]))),
            "sourceAffineRasMm":m.tolist()}

def download(root:Path):
    from huggingface_hub import HfApi,hf_hub_download
    if root.exists():raise ValueError("new_ephemeral_case_directory_required")
    info=HfApi(token=False).repo_info(repo_id=DATASET,repo_type="dataset",token=False)
    if not info.sha.startswith(REV_PREFIX):
        raise ValueError("dataset_revision_changed_await_rights_and_provenance_review")
    root.mkdir(mode=0o700)
    paths={}
    for directory in ("imagesTr","labelsTr"):
        path=f"{directory}/{CASE}"
        archive=Path(hf_hub_download(repo_id=DATASET,repo_type="dataset",
                                    revision=info.sha,filename=path,token=False))
        if archive.stat().st_size>LIMIT_COMPRESSED:raise ValueError("oversize_public_liver_case")
        local=root/("expert" if directory=="labelsTr" else "source")
        local=local.with_suffix(".nii.gz")
        if local.exists():raise ValueError("unexpected_existing_ct")
        shutil.copyfile(archive,local)
        paths[directory]=local
    if sha(paths["labelsTr"])!=EXPERT_SHA:
        raise ValueError("expert_tumor_mask_not_original_pinned_msd_file")
    geom=inspect_pair(paths["imagesTr"],paths["labelsTr"])
    manifest={"schema":"opus-public-msd-task03-liver-ct-admission/v1",
              "dataset":DATASET,"revision":info.sha,
              "caseCode":"liver_25","licenseDeclares":"cc-by-sa-4.0",
              "officialSplit":"train-meaning_not_independent_holdout",
              "sourceSha256":sha(paths["imagesTr"]),
              "expertSha256":EXPERT_SHA,"nativeGeometry":geom,
              "containsOriginalSourceIdentifiers":False,"clinicalValidation":False}
    (root/"manifest.json").write_text(json.dumps(manifest,indent=2))
    print(json.dumps({"status":"genuine_original_msd_liver_case_verified",
                      "sourceSha256":manifest["sourceSha256"],
                      "expertSha256":EXPERT_SHA,
                      "shape":geom["shape"],
                      "expertLesionVoxels":geom["expertTumorVoxels"]}))

def lesion_components(model_mask, affine, minimum_voxels=10):
    """Source-grid liver focal lesion candidates from REAL pretrained mask 1."""
    import numpy as np
    from scipy import ndimage
    m=np.asarray(model_mask)
    a=np.asarray(affine,dtype=float)
    if (m.ndim!=3 or m.size>MAX_VOXELS or
        not np.isin(m,[0,1]).all() or a.shape!=(4,4) or
        not np.isfinite(a).all() or abs(float(np.linalg.det(a[:3,:3])))<1e-8):
        raise ValueError("model_liver_lesion_mask_invalid_native_grid")
    if not 1<=minimum_voxels<=100:
        raise ValueError("invalid_candidate_size")
    labels,n=ndimage.label(m==1,structure=ndimage.generate_binary_structure(3,2))
    found=[]
    voxel_mm3=abs(float(np.linalg.det(a[:3,:3])))
    for idx,box in enumerate(ndimage.find_objects(labels),1):
        if box is None:continue
        cut=labels[box]==idx
        count=int(np.count_nonzero(cut))
        if count<minimum_voxels:continue
        centroid=np.array(ndimage.center_of_mass(cut))+[x.start for x in box]
        world=(a@np.r_[centroid,1])[:3]
        found.append({
          "nativeVoxelBoxIJK":[[int(s.start),int(s.stop-1)] for s in box],
          "nativeVoxelCentroidIJK":[round(float(x),3) for x in centroid],
          "sourceNiftiWorldCentroidMm":[round(float(x),3) for x in world],
          "candidateVolumeMl":round(count*voxel_mm3/1000,4),
          "candidateVoxels":count,
          "isHepaticMalignancyConfirmed":False})
        if len(found)>128:
            raise ValueError("too_many_hepatic_lesion_candidates")
    found.sort(key=lambda x:x["candidateVoxels"],reverse=True)
    return found

def match_expert_lesions(prediction, expert, min_prediction_voxels=10):
    """One-to-one 26-connected overlap on source grid; no fabricated FROC."""
    import numpy as np
    from scipy import ndimage
    p=np.asarray(prediction,dtype=bool)
    g=np.asarray(expert,dtype=bool)
    if p.shape!=g.shape or p.ndim!=3 or p.size>MAX_VOXELS:
        raise ValueError("native_expert_prediction_grid_mismatch")
    structure=ndimage.generate_binary_structure(3,3)
    pl,pn=ndimage.label(p,structure=structure)
    gl,gn=ndimage.label(g,structure=structure)
    sizes=np.bincount(pl.ravel(),minlength=pn+1)
    valid=np.flatnonzero(sizes>=min_prediction_voxels)
    valid=valid[valid!=0]
    if pn>100000 or gn>100000:
        raise ValueError("excessive_lesion_components")
    # Pair counts without dense (n_predictions x n_truth) allocation.
    both=(pl>0)&(gl>0)
    pairs=np.unique(np.stack((pl[both],gl[both]),axis=1),axis=0) if np.any(both) else np.empty((0,2),dtype=int)
    overlaps=[]
    allowed=set(int(x) for x in valid)
    for pi,gi in pairs:
        if int(pi) in allowed:
            n=int(np.count_nonzero((pl==pi)&(gl==gi)))
            overlaps.append((n,int(pi),int(gi)))
    overlaps.sort(reverse=True)
    matched_p=set()
    matched_g=set()
    for n,pi,gi in overlaps:
        if pi not in matched_p and gi not in matched_g:
            matched_p.add(pi)
            matched_g.add(gi)
    return {
        "connectivity":26,
        "minimumPredictedComponentVoxels":min_prediction_voxels,
        "expertLesionCount":int(gn),
        "predictedLesionCount":len(allowed),
        "matchedExpertLesions":len(matched_g),
        "missedExpertLesions":int(gn)-len(matched_g),
        "unmatchedPredictedLesions":len(allowed)-len(matched_p),
        "singleCaseLesionRecall":round(len(matched_g)/int(gn),6) if gn else None,
        "independentFROC":None,
        "matchingRule":"maximum-overlap greedy one-to-one; any positive voxel overlap"
    }

def evaluate(root:Path,mask:Path,out:Path,checkpoint_manifest:Path):
    import nibabel as nib
    import numpy as np
    if out.exists() or out.is_symlink():raise ValueError("result_must_be_new")
    meta=json.loads((root/"manifest.json").read_text())
    model=json.loads(checkpoint_manifest.read_text())
    source=root/"source.nii.gz"
    truth=root/"expert.nii.gz"
    if (meta.get("schema")!="opus-public-msd-task03-liver-ct-admission/v1" or
        meta.get("expertSha256")!=EXPERT_SHA or
        meta.get("dataset")!=DATASET or
        meta.get("revision","")[:7]!=REV_PREFIX or
        sha(source)!=meta["sourceSha256"] or sha(truth)!=EXPERT_SHA or
        model.get("task")!="liver_lesions" or
        not isinstance(model.get("checkpointSha256"),str) or
        len(model["checkpointSha256"])!=64):
        raise ValueError("model_or_ct_provenance_failed")
    geo=inspect_pair(source,truth)
    if geo["shape"]!=meta["nativeGeometry"]["shape"]:raise ValueError("native_series_shape_changed")
    if mask.is_symlink() or not mask.is_file() or mask.stat().st_size>256*1024**2:
        raise ValueError("trained_model_mask_missing_or_oversize")
    seg=nib.load(str(mask))
    scan=nib.load(str(source))
    if seg.shape!=scan.shape or seg.ndim!=3 or seg.header.get_data_dtype().kind not in ("i","u"):
        raise ValueError("predicted_tumor_mask_grid_changed")
    for i in (0,scan.shape[0]-1):
     for j in (0,scan.shape[1]-1):
      for k in (0,scan.shape[2]-1):
       p=np.array([i,j,k,1],dtype=np.float64)
       if np.linalg.norm((seg.affine@p)[:3]-(scan.affine@p)[:3])>0.05:
        raise ValueError("model_mask_not_physically_registered_to_ct")
    prediction=np.asarray(seg.dataobj)
    if not np.isin(prediction,[0,1]).all():
        raise ValueError("unexpected_total_segmentator_liver_lesions_labels")
    gt=(np.asarray(nib.load(str(truth)).dataobj)==2)
    pred=(prediction==1)
    focal_candidates=lesion_components(prediction,scan.affine)
    lesion_match=match_expert_lesions(pred,gt)
    tp=int(np.count_nonzero(pred & gt))
    fp=int(np.count_nonzero(pred & ~gt))
    fn=int(np.count_nonzero(~pred & gt))
    modelvox=tp+fp;expertvox=tp+fn
    dice=2*tp/(2*tp+fp+fn)
    result={"schema":"opus-real-public-liver-lesions-expert-comparison/v1",
      "model":"TotalSegmentator 2.18.0", "task":"liver_lesions",
      "actualPretrainedInferenceCompleted":True,
      "source":"Medical Segmentation Decathlon Task03 Liver, one public training CT",
      "officialTrainingHoldoutProven":False,
      "sourceSha256":meta["sourceSha256"],"expertMaskSha256":EXPERT_SHA,
      "predictedMaskSha256":sha(mask),"checkpointSha256":model["checkpointSha256"],
      "checkpointPublisherSigned":False,
      "originalDimensions":geo["shape"],"expertTumorVoxels":expertvox,
      "modelLesionVoxels":modelvox,"lesionCandidates":focal_candidates,
      "lesionCandidateCount":len(focal_candidates),
      "expertLesionMatching":lesion_match,
      "noMalignancyEstablished":False,
      "NIfTIWorldNotVerifiedDICOMLPS":True,
      "truePositiveVoxels":tp,
      "falsePositiveVoxels":fp,"falseNegativeVoxels":fn,
      "tumorDiceOnThisOneVolume":round(dice,6),
      "oneVolumeVoxelRecall":round(tp/expertvox,6),
      "oneVolumeVoxelPrecision":round(tp/modelvox,6) if modelvox else None,
      "meanLesionDetectionSensitivity":None,"FROC":None,
      "clinicalValidation":False,"diagnosisAllowed":False,
      "limitations":["One annotated training split case; independence from upstream model training not established.",
        "MSD class 2 is annotated tumor; TotalSegmentator liver_lesions class 1 targets general focal lesions; label scope is not fully equivalent.",
        "Measured voxel Dice does not establish malignancy type, patient-level sensitivity or clinical deployment eligibility.",
        "Single-case 26-connected overlap recalls annotated components, not independent lesion sensitivity; greedy matching and minimum predicted size must be disclosed.",
        "Original data and full model checkpoints deleted from CI, numeric output only."]}
    out.write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result[k] for k in
      ("task","expertTumorVoxels","modelLesionVoxels","truePositiveVoxels",
       "falsePositiveVoxels","falseNegativeVoxels","tumorDiceOnThisOneVolume",
       "clinicalValidation")}))
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","evaluate"),required=True)
    p.add_argument("--dir",type=Path,required=True)
    p.add_argument("--mask",type=Path)
    p.add_argument("--out",type=Path)
    p.add_argument("--checkpoint-manifest",type=Path)
    a=p.parse_args()
    if a.mode=="prepare":download(a.dir)
    elif a.mask and a.out and a.checkpoint_manifest:evaluate(a.dir,a.mask,a.out,a.checkpoint_manifest)
    else:raise ValueError("expected_model_mask_result_and_checkpoint_manifest")
