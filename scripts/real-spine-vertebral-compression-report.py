#!/usr/bin/env python3
"""Real research spine height-deformity runner using official TotalSegmentator 2.18.

Not a fracture classifier. Genuine vertebral segmentation plus height measurement
only, public de-identified source, isolated high-RAM worker, native-grid evidence.
No synthetic model predictions or remote patient mode.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

VERSION="2.18.0"
SCHEMA="opus-spine-vertebral-height-ct/v1"
SOURCE_URL="https://github.com/wasserth/TotalSegmentator/tree/v2.18.0"
LEVELS=[f"T{i}" for i in range(1,13)]+[f"L{i}" for i in range(1,6)]
MAX_SOURCE_BYTES=750*1024**2
MAX_SOURCE_VOXELS=512*512*600

def digest(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for data in iter(lambda:f.read(1024*1024),b""):
            h.update(data)
    return h.hexdigest()

def validate_image(path:Path):
    import numpy as np
    import nibabel as nib
    if (path.is_symlink() or not path.is_file() or
        not 1024<=path.stat().st_size<=MAX_SOURCE_BYTES):
        raise ValueError("invalid_or_oversize_public_CT")
    img=nib.load(str(path))
    if (img.ndim!=3 or min(img.shape)<20 or
        math.prod(img.shape)>MAX_SOURCE_VOXELS or
        img.header.get_xyzt_units()[0]!="mm" or
        not np.isfinite(img.affine).all() or
        abs(float(np.linalg.det(img.affine[:3,:3])))<1e-5):
        raise ValueError("public_CT_invalid_voxel_geometry")
    return img

def finite_optional(value,low,high):
    if value is None or value=="":
        return None
    if not isinstance(value,(int,float)) or not math.isfinite(float(value)):
        raise ValueError("nonfinite_model_height_or_intensity_measurement")
    if not low<=float(value)<=high:
        raise ValueError("model_measurement_outside_plausible_bounded_range")
    return float(value)

def parse_report(raw,level_masks,source_sha,source_meta,report_sha,mask_sha):
    """Process only named numeric clinical features, excluding all DICOM PII."""
    if not isinstance(raw,dict) or not isinstance(raw.get("results"),dict):
        raise ValueError("not_original_totalseg_spine_json")
    values=raw["results"]
    results=[]
    for level in LEVELS:
        name=f"vertebrae_{level}"
        variation=finite_optional(values.get(name+"_height_difference"),0,1.5)
        density=finite_optional(values.get(name+"_intensity_median"),-1200,4000)
        voxel_box=level_masks.get(name)
        if variation is None and density is None and voxel_box is None:
            continue
        results.append({
            "vertebra":level,
            "heightDifferenceFraction":variation,
            "medianCTAttenuationHU":density,
            "sourceVoxelBox":voxel_box,
            "heightLossOver20PctCandidate":variation is not None and variation>0.2,
            "fractureDiagnosisProven":False
        })
    if not results:
        raise ValueError("no_original_model_vertebral_measurements_or_spatial_masks")
    return {
        "schema":SCHEMA,
        "modality":"CT",
        "clinicalTask":"vertebral_compression_deformity_screening_candidate",
        "originalModel":"TotalSegmentator Spine Report",
        "originalModelRelease":VERSION,
        "publisherSourceURL":SOURCE_URL,
        "originalSourceCTSHA256":source_sha,
        "originalSourceRights":source_meta["license"],
        "originalSourceReferenceURL":source_meta["url"],
        "modelResultSHA256":report_sha,
        "originalVertebralMaskSHA256":mask_sha,
        "numVertebraeMeasuredOrSegmented":len(results),
        "heightLossOver20PctCandidates":[r["vertebra"] for r in results if r["heightLossOver20PctCandidate"]],
        "vertebrae":results,
        "nativeGeometryMatched":True,
        "realPublishedPretrainedModelInferenceAttested":True,
        "modelWeightsSHA256Verified":False,
        "expertFractureGradeAvailable":False,
        "expertDiseaseAccuracy":None,
        "researchOnly":True,
        "patientUseAllowed":False,
        "limitations":[
          "Model-derived vertebral body height difference is a morphology flag, NOT a definitive fracture.",
          "Osteoporosis and CT attenuation thresholds depend on protocol and require clinician validation.",
          "Full native anatomy, true pretrained weights and geometry must be verified per execution.",
          "Original model checkpoint files have not been independently pinned by this wrapper.",
          "No expert Genant scores or pathologic-fracture differential verified.",
          "Not authorized for real patient processing or cloud LLM upload."
        ]
    }

def level_bboxes(mask_path,original):
    import numpy as np
    import nibabel as nib
    from scipy import ndimage
    from totalsegmentator.nifti_ext_header import load_multilabel_nifti
    if mask_path.is_symlink() or not mask_path.is_file():
        raise ValueError("missing_actual_pretrained_vertebrae_pp_refined_mask")
    mask,labelmap=load_multilabel_nifti(mask_path)
    if (mask.shape!=original.shape or
        not np.allclose(mask.affine,original.affine,rtol=0,atol=0.12) or
        mask.header.get_data_dtype().kind not in "iu"):
        raise ValueError("model_vertebral_mask_not_on_CT_native_physical_grid")
    volume=np.asarray(mask.dataobj)
    if volume.size>MAX_SOURCE_VOXELS or not np.isfinite(volume).all():
        raise ValueError("unbounded_spine_segmentation")
    objects=ndimage.find_objects(volume)
    boxes={}
    for ident,name in labelmap.items():
        if name not in (f"vertebrae_{x}" for x in LEVELS):
            continue
        if not isinstance(ident,int) or not 1<=ident<=len(objects):
            raise ValueError("invalid_original_multilabel_spine_mask_id")
        region=objects[ident-1]
        if region is None:
            continue
        boxes[name]=[[int(s.start),int(s.stop-1)] for s in region]
    if not boxes:
        raise ValueError("no_named_vertebral_anatomy_in_real_mask")
    return boxes

def check_worker():
    import importlib.metadata
    if importlib.metadata.version("TotalSegmentator")!=VERSION:
        raise ValueError("unsupported_Totalsegmentator_vendor_version")
    binary=shutil.which("totalseg_spine_report")
    if binary is None:
        raise ValueError("official_spine_report_executable_missing")
    if os.name!="posix" or not Path("/proc/meminfo").is_file():
        raise ValueError("isolated_Linux_worker_required")
    data=Path("/proc/meminfo").read_text()
    available=int(next(x.split()[1] for x in data.splitlines()
                       if x.startswith("MemAvailable:")))*1024
    if available<12*1024**3:
        raise RuntimeError("separate_high_RAM_worker_required")
    return binary

def run(ct,output,license_name,reference_url,timeout):
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("output_must_be_a_new_numeric_JSON")
    if output.suffix.lower()!=".json" or license_name not in ("CC BY 3.0","CC BY 4.0","CC0"):
        raise ValueError("public_CT_requires_explicit_approved_public_license")
    if not (reference_url.startswith("https://") and len(reference_url)<=1024):
        raise ValueError("original_public_dataset_reference_required")
    original=validate_image(ct)
    binary=check_worker()
    with tempfile.TemporaryDirectory(prefix="opus-real-spine-") as folder:
        tmp=Path(folder)
        report=tmp/"spine-report.json"
        output_mask=tmp/"spine-report.nii.gz"
        logfile=tmp/"model-inference.log"
        modeldir=tmp/"native"
        modeldir.mkdir(mode=0o700)
        env=os.environ.copy()
        env["TOTALSEG_HOME_DIR"]=str(tmp/"vendor-model-cache")
        env["OMP_NUM_THREADS"]="2"
        env["ITK_GLOBAL_DEFAULT_NUMBER_OF_THREADS"]="2"
        # Do not print or export any original patient metadata or DICOM identifiers.
        command=[binary,"-i",str(ct),"-o",str(output_mask),"-j",str(report),
                 "-l",str(logfile),"-tmp",str(modeldir)]
        try:
            p=subprocess.run(command,env=env,timeout=timeout,
                             stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,
                             check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("pretrained_spine_model_execution_timeout") from exc
        if p.returncode!=0 or not report.is_file() or not output_mask.is_file():
            raise RuntimeError("original_spine_report_real_inference_did_not_complete")
        marker=modeldir/"totalseg_vertebrae_pp_refined.nii.gz"
        bboxes=level_bboxes(marker,original)
        result=json.loads(report.read_text())
        evidence=parse_report(result,bboxes,digest(ct),{"license":license_name,"url":reference_url},
                              digest(report),digest(marker))
        output.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+"\n")
        print(json.dumps({"task":evidence["clinicalTask"],
                          "realOriginalReportCompleted":True,
                          "vertebralLevels":evidence["numVertebraeMeasuredOrSegmented"],
                          "heightDeformityCandidates":len(evidence["heightLossOver20PctCandidates"]),
                          "expertDiseaseAccuracy":None,
                          "patientUseAllowed":False}))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--ct",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    p.add_argument("--source-license",required=True)
    p.add_argument("--source-url",required=True)
    p.add_argument("--timeout",type=int,default=1800)
    p.add_argument("--public-research-consent",action="store_true")
    a=p.parse_args()
    if not a.public_research_consent or a.timeout<60 or a.timeout>3600:
        raise ValueError("only_approved_public_research_not_patient_mode")
    run(a.ct,a.output,a.source_license,a.source_url,a.timeout)

if __name__=="__main__":
    main()
