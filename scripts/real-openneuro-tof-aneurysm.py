#!/usr/bin/env python3
"""First genuine pretrained TOF-MRA intracranial aneurysm research evaluation.

Public OpenNeuro ds003949 CC0, mirrored git-annex blobs with size+MD5 checks.
TotalSegmentator brain_aneurysm is CC BY-NC 4.0 / NON-COMMERCIAL only.
Original manual masks may be weak/non-voxel-exact; dataset/model train overlap
is unknown. Dice is descriptive, not independent clinical validation.
No images or lesion coordinates are uploaded as artifacts.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
from urllib.request import Request,urlopen

GIT_SHA="8921f7b9beab038e1a314f9aab84d7358c4568c5"
SOURCE="sub-013/ses-20101220/anat/sub-013_ses-20101220_angio.nii.gz"
MASK="derivatives/manual_masks/sub-013/ses-20101220/anat/sub-013_ses-20101220_desc-Lesion_1_mask.nii.gz"
# Original git-annex pointers at pinned OpenNeuroDatasets/ds003949 commit.
FILES={
 "tof":(SOURCE,28579756,"693bfe8bba274e0fd7f7f0cc90a92d9b"),
 "manual":(MASK,22471,"8a8592edeae946f7fec7e28fe0af5157"),
}
BASE="https://s3.amazonaws.com/openneuro.org/ds003949/"
SCHEMA="opus-real-tof-aneurysm-public-manual-mask-comparison/v1"

def digest(path,algorithm="sha256"):
    h=hashlib.new(algorithm)
    with Path(path).open("rb") as f:
        for part in iter(lambda:f.read(1024*1024),b""):
            h.update(part)
    return h.hexdigest()

def get_pinned_file(url,dest,exact_size,expected_md5):
    if dest.exists() or dest.is_symlink():raise ValueError("expected_unused_ephemeral_output")
    request=Request(url,headers={"User-Agent":"OpusRadiologyPublicResearch/1.0"})
    h=hashlib.md5(usedforsecurity=False)
    total=0
    try:
        with urlopen(request,timeout=90) as src,dest.open("xb") as dst:
            while True:
                chunk=src.read(1024*1024)
                if not chunk:break
                total+=len(chunk)
                if total>exact_size:raise ValueError("public_original_exceeds_pinned_annex_size")
                h.update(chunk)
                dst.write(chunk)
        if total!=exact_size or h.hexdigest()!=expected_md5:
            raise ValueError("downloaded_public_file_differs_from_original_git_annex")
    except Exception:
        dest.unlink(missing_ok=True)
        raise

def verify_pair(tof,reference):
    import nibabel as nib
    import numpy as np
    a,b=nib.load(str(tof)),nib.load(str(reference))
    shape=a.shape
    if (a.ndim!=3 or b.ndim!=3 or shape!=b.shape or
        min(shape)<16 or max(shape)>512 or math.prod(shape)>100_000_000 or
        not np.isfinite(a.affine).all() or
        abs(float(np.linalg.det(a.affine[:3,:3])))<0.000001):
        raise ValueError("original_TOF_manual_mask_shape_invalid")
    units_a=a.header.get_xyzt_units()[0]
    units_b=b.header.get_xyzt_units()[0]
    if units_a!=units_b or units_a not in ("mm","unknown"):
        raise ValueError("original_manual_mask_spatial_units_changed")
    if not np.allclose(a.affine,b.affine,rtol=0,atol=0.0001):
        raise ValueError("original_manual_mask_not_on_native_TOF_grid")
    image=np.asarray(a.dataobj)
    if not np.isfinite(image).all() or image.max()<=image.min():
        raise ValueError("TOF_volumetric_signal_missing")
    labels=np.asarray(b.dataobj)
    if not np.isfinite(labels).all() or not np.isin(labels,[0,1]).all():
        raise ValueError("source_manual_mask_not_binary")
    truth=int(np.count_nonzero(labels))
    if truth==0:raise ValueError("positive_aneurysm_manual_reference_empty")
    return {"shape":list(shape),"spatialUnits":units_a,"positiveManualMaskVoxels":truth,
            "nativeExpertMaskAffineExact":True}

def prepare(folder):
    if folder.exists():raise ValueError("case_output_directory_not_new")
    folder.mkdir(mode=0o700,parents=True)
    for name,(rel,length,hash_) in FILES.items():
        get_pinned_file(BASE+rel,folder/(name+".nii.gz"),length,hash_)
    geo=verify_pair(folder/"tof.nii.gz",folder/"manual.nii.gz")
    meta={
        "schema":"opus-public-openneuro-tof-aneurysm-admission/v1",
        "dataset":"OpenNeuro ds003949, Lausanne TOF-MRA aneurysm cohort",
        "license":"CC0",
        "originalGitAnnexMirrorCommit":GIT_SHA,
        "study":"sub-013 / ses-20101220 (positive lesion reference)",
        "originalTOFRelativePath":SOURCE,
        "originalManualMaskRelativePath":MASK,
        "sourceOriginalAnnexMD5":FILES["tof"][2],
        "expertOriginalAnnexMD5":FILES["manual"][2],
        "TOFSha256":digest(folder/"tof.nii.gz"),
        "manualMaskSha256":digest(folder/"manual.nii.gz"),
        "sourceSpatialMetadata":geo,
        "referenceAnnotationMayBeWeak":True,
        "independentModelTrainingHoldoutVerified":False,
        "containsNonpublicPatientData":False,
        "clinicalValidation":False
    }
    (folder/"admission.json").write_text(json.dumps(meta,indent=2))
    print(json.dumps({"originalPublicTOFMRAAdmitted":True,
      "sourceShape":geo["shape"],
      "sourceSpatialUnits":geo["spatialUnits"],
      "manualPositiveVoxels":geo["positiveManualMaskVoxels"],
      "TOFSha256":meta["TOFSha256"]}))

def evaluate(folder,model_mask,weights_manifest,out):
    import nibabel as nib
    import numpy as np
    if out.exists() or out.is_symlink():raise ValueError("research_numeric_output_must_be_new")
    meta=json.loads((folder/"admission.json").read_text())
    weights=json.loads(weights_manifest.read_text())
    if (meta.get("schema")!="opus-public-openneuro-tof-aneurysm-admission/v1" or
        meta.get("originalGitAnnexMirrorCommit")!=GIT_SHA or
        meta.get("license")!="CC0" or
        meta.get("independentModelTrainingHoldoutVerified") is not False or
        meta.get("TOFSha256")!=digest(folder/"tof.nii.gz") or
        meta.get("manualMaskSha256")!=digest(folder/"manual.nii.gz") or
        weights.get("task")!="brain_aneurysm" or
        weights.get("packageVersion")!="2.18.0" or
        weights.get("modelLicense")!="CC BY-NC 4.0 - noncommercial only" or
        not isinstance(weights.get("observedCheckpointSha256"),str) or
        len(weights["observedCheckpointSha256"])!=64):
        raise ValueError("public_TOF_or_licensed_model_provenance_invalid")
    geo=verify_pair(folder/"tof.nii.gz",folder/"manual.nii.gz")
    if geo!=meta["sourceSpatialMetadata"]:
        raise ValueError("native_TOF_reference_spatial_metadata_changed")
    if (not model_mask.is_file() or model_mask.is_symlink() or
        model_mask.stat().st_size>256*1024*1024):
        raise ValueError("real_model_prediction_file_missing")
    image=nib.load(str(folder/"tof.nii.gz"))
    expert=nib.load(str(folder/"manual.nii.gz"))
    model=nib.load(str(model_mask))
    if (model.ndim!=3 or model.shape!=image.shape or
        model.header.get_xyzt_units()[0] not in ("mm","unknown") or
        model.header.get_data_dtype().kind not in ("u","i","f")):
        raise ValueError("real_model_output_not_native_TOF_shape")
    for i in (0,image.shape[0]-1):
      for j in (0,image.shape[1]-1):
       for k in (0,image.shape[2]-1):
        p=np.array([i,j,k,1],dtype=np.float64)
        if np.linalg.norm((image.affine@p)[:3]-(model.affine@p)[:3])>0.05:
            raise ValueError("real_aneurysm_mask_not_native_TOF_registration")
    output=np.asarray(model.dataobj)
    if not np.isfinite(output).all() or not np.isin(output,[0,1]).all():
        raise ValueError("not_real_binary_brain_aneurysm_model_label")
    predicted=output==1
    manual=np.asarray(expert.dataobj)==1
    tp=int(np.count_nonzero(predicted & manual))
    fp=int(np.count_nonzero(predicted & ~manual))
    fn=int(np.count_nonzero(~predicted & manual))
    dice=2*tp/(2*tp+fp+fn)
    report={
        "schema":SCHEMA,
        "model":"TotalSegmentator 2.18.0 official pretrained",
        "task":"brain_aneurysm",
        "modelLicense":"CC BY-NC 4.0 noncommercial research ONLY",
        "commercialUseOfThisModelProhibited":True,
        "input":"original TOF-MRA, NOT T1 MRI",
        "originalPublicDataset":"OpenNeuro ds003949",
        "originalPublicDatasetLicense":"CC0",
        "sourceGitAnnexCommit":GIT_SHA,
        "sourceOriginalTOFSha256":meta["TOFSha256"],
        "sourceOriginalManualMaskSha256":meta["manualMaskSha256"],
        "trainedModelOutputSha256":digest(model_mask),
        "observedOfficialCheckpointSha256":weights["observedCheckpointSha256"],
        "trainedPretrainedInferenceFinished":True,
        "nativeGridVerified":True,
        "spatialUnitsFromSource":geo["spatialUnits"],
        "nativeVolumeShape":geo["shape"],
        "manualReferenceIsNotNecessarilyVoxelPrecise":True,
        "expertReferenceVoxels":int(np.count_nonzero(manual)),
        "predictedAneurysmLabel1Voxels":int(np.count_nonzero(predicted)),
        "truePositiveVoxelsAgainstManual":tp,
        "falsePositiveVoxelsAgainstManual":fp,
        "falseNegativeVoxelsAgainstManual":fn,
        "voxelDiceAgainstProvidedManualMask":round(dice,6),
        "voxelRecallAgainstProvidedManualMask":round(tp/(tp+fn),6),
        "lesionLevelSensitivity":None,
        "independentTrainingHoldoutProven":False,
        "diagnosisPermitted":False,
        "clinicalValidation":False,
        "limitations":[
            "Original OpenNeuro reference segmentation quality (precise vs weak) not established on this case.",
            "Model may have been trained on OpenNeuro data; independent holdout not established.",
            "Model is CC BY-NC, cannot be integrated into commercial Opus without a different license/model.",
            "Voxel Dice on one case does not establish detection sensitivity or patient-specific diagnosis."
        ]
    }
    out.write_text(json.dumps(report,indent=2))
    print(json.dumps({k:report[k] for k in [
        "task","expertReferenceVoxels","predictedAneurysmLabel1Voxels",
        "truePositiveVoxelsAgainstManual","falsePositiveVoxelsAgainstManual",
        "falseNegativeVoxelsAgainstManual","voxelDiceAgainstProvidedManualMask",
        "clinicalValidation"]}))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("prepare","evaluate"),required=True)
    p.add_argument("--dir",required=True,type=Path)
    p.add_argument("--model-mask",type=Path)
    p.add_argument("--weights-manifest",type=Path)
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    if args.mode=="prepare":prepare(args.dir)
    elif args.model_mask and args.weights_manifest and args.output:
        evaluate(args.dir,args.model_mask,args.weights_manifest,args.output)
    else:raise ValueError("missing_actual_trained_model_evidence")
if __name__=="__main__":main()
