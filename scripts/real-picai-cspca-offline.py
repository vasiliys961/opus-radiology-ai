#!/usr/bin/env python3
"""Offline PI-CAI csPCa research executor: original, preinstalled digest-pinned vendor image.

No model download, no patient use, no cloud and no claimed clinical validation.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile

SCHEMA="opus-picai-cspca-bpmri-public-research/v1"
PUBLISHER="https://github.com/DIAGNijmegen/picai_nnunet_gc_algorithm"
IMAGE_RE=re.compile(r"sha256:[0-9a-f]{64}\Z")
MAX_MHA=1024*1024**3
MAX_VOXELS=512*512*200

def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(1048576),b""):
            h.update(block)
    return h.hexdigest()

def require_standalone_mha(path):
    if (path.is_symlink() or not path.is_file() or path.suffix.lower()!=".mha"
        or not 1024<=path.stat().st_size<=MAX_MHA):
        raise ValueError("bounded_public_standalone_MHA_required")
    with path.open("rb") as stream:
        raw=stream.read(8192).split(b"ElementDataFile",1)
    if len(raw)!=2 or not re.match(rb"\s*=\s*LOCAL(?:\s|$)",raw[1],re.I):
        raise ValueError("embedded_pixels_only_not_external_raw")

def check_geometry(images):
    import numpy as np
    if len(images)!=3:
        raise ValueError("three_bpMRI_sequences_required")
    centers=[]
    for image in images:
        shape=np.asarray(image.GetSize(),dtype=int)
        spacing=np.asarray(image.GetSpacing(),dtype=float)
        direction=np.asarray(image.GetDirection(),dtype=float).reshape(3,3)
        origin=np.asarray(image.GetOrigin(),dtype=float)
        if (shape.shape!=(3,) or np.min(shape)<5 or math.prod(shape)>MAX_VOXELS
            or spacing.shape!=(3,) or not np.isfinite(spacing).all()
            or np.min(spacing)<.2 or np.max(spacing)>9
            or not np.isfinite(direction).all()
            or not np.allclose(direction.T@direction,np.eye(3),atol=.04)
            or abs(abs(float(np.linalg.det(direction)))-1)>.04
            or not np.isfinite(origin).all()):
            raise ValueError("invalid_MR_geometry")
        centers.append(origin+direction@(spacing*(shape-1)/2))
    if max(float(np.linalg.norm(centers[0]-c)) for c in centers[1:])>30:
        raise ValueError("T2_ADC_HBV_coverage_centers_not_aligned")

def docker_command(image_id,t2,adc,hbv,outdir):
    if not IMAGE_RE.fullmatch(image_id):
        raise ValueError("local_algorithm_image_SHA256_ID_required")
    if any(not p.is_absolute() or not p.is_file() for p in (t2,adc,hbv)):
        raise ValueError("three_absolute_input_files_required")
    if not outdir.is_absolute() or not outdir.is_dir():
        raise ValueError("private_output_dir_required")
    cmd=["docker","run","--rm","--network","none","--gpus","all",
         "--read-only","--cap-drop=ALL","--security-opt=no-new-privileges",
         "--pids-limit=512","--memory=32g","--cpus=8","--shm-size=2g",
         "--tmpfs","/tmp:rw,nosuid,nodev,size=2g",
         "--tmpfs","/opt/algorithm/nnunet/input:rw,nosuid,nodev,size=2g",
         "--tmpfs","/opt/algorithm/nnunet/output:rw,nosuid,nodev,size=3g",
         "--mount",f"type=bind,src={outdir},dst=/output,rw"]
    for src,dst in (
        (t2,"/input/images/transverse-t2-prostate-mri/scan.mha"),
        (adc,"/input/images/transverse-adc-prostate-mri/scan.mha"),
        (hbv,"/input/images/transverse-hbv-prostate-mri/scan.mha")):
        cmd+=["--mount",f"type=bind,src={src},dst={dst},readonly"]
    return cmd+[image_id]

def candidates(detection_map,spacing_xyz,origin_lps,direction_matrix,
               threshold=.30,min_voxels=3):
    import numpy as np
    from scipy import ndimage
    a=np.asarray(detection_map)
    if (a.ndim!=3 or min(a.shape)<5 or a.size>MAX_VOXELS
        or not np.issubdtype(a.dtype,np.floating) or not np.isfinite(a).all()
        or float(a.min())<0 or float(a.max())>1):
        raise ValueError("vendor_detection_map_invalid")
    if not .05<=threshold<=.95 or not 1<=min_voxels<=200:
        raise ValueError("research_probability_threshold_out_of_range")
    sp=np.asarray(spacing_xyz,dtype=float)
    origin=np.asarray(origin_lps,dtype=float)
    direction=np.asarray(direction_matrix,dtype=float).reshape(3,3)
    if (sp.shape!=(3,) or origin.shape!=(3,) or not np.isfinite(sp).all()
        or not np.isfinite(origin).all() or np.min(sp)<.2 or np.max(sp)>9
        or not np.isfinite(direction).all()
        or not np.allclose(direction.T@direction,np.eye(3),atol=.04)):
        raise ValueError("invalid_T2_physical_frame")
    labels,n=ndimage.label(a>=threshold,structure=ndimage.generate_binary_structure(3,2))
    counts=np.bincount(labels.ravel())
    locations=ndimage.find_objects(labels)
    found=[]
    for component in range(1,n+1):
        count=int(counts[component])
        if count<min_voxels:continue
        sl=locations[component-1]
        local=labels[sl]==component
        ijk_zyx=np.column_stack(np.where(local)).mean(axis=0)+np.array([s.start for s in sl])
        xyz=ijk_zyx[::-1]
        lps=origin+direction@(xyz*sp)
        ras=lps*np.array([-1,-1,1])
        scores=a[sl][local]
        found.append({
            "originalT2VoxelBoundingBoxZYX":[[int(s.start),int(s.stop-1)] for s in sl],
            "originalT2CentroidIndexXYZ":[round(float(v),3) for v in xyz],
            "originalT2CentroidWorldRASmm":[round(float(v),3) for v in ras],
            "candidateVolumeMm3":round(float(count*np.prod(sp)),3),
            "candidateVoxels":count,
            "rawUncalibratedPeakScore":round(float(scores.max()),6),
            "rawUncalibratedMeanScore":round(float(scores.mean()),6),
            "confirmedCancer":False})
    found.sort(key=lambda v:v["rawUncalibratedPeakScore"],reverse=True)
    if len(found)>128:
        raise ValueError("too_many_lesion_candidates")
    return found

def verify_vendor_map(result,t2,likelihood):
    import numpy as np
    import SimpleITK as sitk
    if (result.GetSize()!=t2.GetSize()
        or not np.allclose(result.GetSpacing(),t2.GetSpacing(),rtol=0,atol=1e-4)
        or not np.allclose(result.GetOrigin(),t2.GetOrigin(),rtol=0,atol=1e-3)
        or not np.allclose(result.GetDirection(),t2.GetDirection(),rtol=0,atol=1e-4)):
        raise ValueError("vendor_map_not_on_original_T2_grid")
    if (type(likelihood) not in (int,float) or not np.isfinite(likelihood)
        or not 0<=likelihood<=1):
        raise ValueError("vendor_case_score_invalid")
    arr=sitk.GetArrayFromImage(result)
    if (not np.isfinite(arr).all() or float(arr.min())<0
        or float(arr.max())>1 or abs(float(arr.max())-likelihood)>1e-4):
        raise ValueError("vendor_detection_map_and_case_score_disagree")

def run(t2,adc,hbv,image_id,license_name,source_url,output,threshold=.3):
    import SimpleITK as sitk
    if (license_name not in ("CC0","CC BY 3.0","CC BY 4.0")
        or not source_url.startswith("https://") or len(source_url)>1024
        or any(c in source_url for c in "@?#")):
        raise ValueError("licensed_public_dataset_without_secrets_required")
    if output.exists() or output.is_symlink() or output.suffix!=".json" or not output.parent.is_dir():
        raise ValueError("new_numeric_only_JSON_output_required")
    for path in (t2,adc,hbv):require_standalone_mha(path)
    if len({p.resolve() for p in (t2,adc,hbv)})!=3:
        raise ValueError("distinct_bpMRI_source_series_required")
    images=[sitk.ReadImage(str(p)) for p in (t2,adc,hbv)]
    check_geometry(images)
    if sys.platform!="linux" or not Path("/proc/meminfo").is_file():
        raise RuntimeError("separate_Linux_GPU_worker_only")
    mem=Path("/proc/meminfo").read_text()
    available=int(next(x.split()[1] for x in mem.splitlines() if x.startswith("MemAvailable:")))*1024
    if available<24*1024**3:
        raise RuntimeError("24GiB_available_RAM_required_not_Mac_M1")
    if not IMAGE_RE.fullmatch(image_id):
        raise ValueError("pinned_local_vendor_image_required")
    inspected=subprocess.run(
        ["docker","image","inspect",image_id,"--format","{{.Id}}"],
        capture_output=True,text=True,timeout=30,check=False)
    if inspected.returncode!=0 or inspected.stdout.strip()!=image_id:
        raise ValueError("vendor_container_image_sha_unverified")
    with tempfile.TemporaryDirectory(prefix="opus-picai-public-") as tmp:
        outdir=Path(tmp)/"result"
        outdir.mkdir(mode=0o700)
        cmd=docker_command(image_id,t2.resolve(),adc.resolve(),hbv.resolve(),outdir)
        completed=subprocess.run(cmd,capture_output=True,timeout=3600,check=False)
        # Never emit model stdout/stderr, which could contain source identifiers.
        if completed.returncode!=0:
            raise RuntimeError("isolated_original_model_failed_no_diagnosis")
        map_path=outdir/"images/cspca-detection-map/cspca_detection_map.mha"
        case_path=outdir/"cspca-case-level-likelihood.json"
        if (not map_path.is_file() or map_path.is_symlink() or not case_path.is_file()
            or case_path.is_symlink() or map_path.stat().st_size>MAX_MHA
            or case_path.stat().st_size>1024):
            raise ValueError("original_vendor_prediction_missing_or_unbounded")
        likelihood=json.loads(case_path.read_text())
        map_img=sitk.ReadImage(str(map_path))
        verify_vendor_map(map_img,images[0],likelihood)
        results=candidates(sitk.GetArrayFromImage(map_img),images[0].GetSpacing(),
                           images[0].GetOrigin(),images[0].GetDirection(),threshold)
        evidence={
            "schema":SCHEMA,
            "pathology":"clinically_significant_prostate_cancer_candidate",
            "source":PUBLISHER,
            "pinnedLocalVendorContainerImageSHA256":image_id.removeprefix("sha256:"),
            "originalBpMRISHA256":{"T2":digest(t2),"ADC":digest(adc),"highB":digest(hbv)},
            "originalVendorMapSHA256":digest(map_path),
            "sourceDatasetLicense":license_name,"publicDatasetURL":source_url,
            "T2_ADC_highB_sequenceAndEligibilityOperatorAttested":True,
            "originalT2OutputPhysicalGridMatched":True,
            "offlineVendorContainerActuallyExecuted":True,
            "originalTrainedWeightsIndependentlyVerified":False,
            "independentHeldoutClinicalAccuracyEstablished":False,
            "vendorCaseRawUncalibratedScore":likelihood,
            "reviewThresholdUncalibrated":threshold,
            "candidateCount":len(results),"candidateComponents":results,
            "cancerProven":False,"absenceOfCancerEstablished":False,
            "patientUseAllowed":False,"researchOnly":True,"expertMetrics":None,
            "limitations":[
                "Original local vendor image must contain lawfully accessible genuine pretrained folds.",
                "Docker image SHA does not independently verify its internal trained checkpoint.",
                "No clinical PI-RADS assignment, calibrated likelihood or pathology diagnosis.",
                "No independently validated biopsy histology/FROC/Dice or patient deployment.",
                "No real patient scans, cloud LLM upload, or local Mac M1 8GB execution."]
        }
    output.write_text(json.dumps(evidence,indent=2)+"\n",encoding="utf-8")
    return evidence

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("t2","adc","hbv","output"):
        p.add_argument("--"+name,required=True,type=Path)
    p.add_argument("--original-docker-image-id",required=True)
    p.add_argument("--source-license",required=True)
    p.add_argument("--source-url",required=True)
    p.add_argument("--research-threshold",type=float,default=.30)
    p.add_argument("--licensed-public-deidentified-bpmri-verified",action="store_true")
    p.add_argument("--sequence-and-treatment-eligibility-confirmed",action="store_true")
    args=p.parse_args()
    if not (args.licensed_public_deidentified_bpmri_verified
            and args.sequence_and_treatment_eligibility_confirmed):
        p.error("Public licensed bpMRI and independently confirmed T2 ADC HBV required")
    r=run(args.t2,args.adc,args.hbv,args.original_docker_image_id,args.source_license,
          args.source_url,args.output,args.research_threshold)
    print(json.dumps({"schema":SCHEMA,"candidateCount":r["candidateCount"],"researchOnly":True}))

if __name__=="__main__":main()
