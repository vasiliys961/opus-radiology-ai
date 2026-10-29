#!/usr/bin/env python3
"""Source-native MONAI DiNTS pancreas tumor task on a supplied ORIGINAL HU CT.

Reuses verified preprocessing and original 3-class TorchScript inference from
scripts/real-msd-pancreatic-tumor-dints.py, but does NOT require an expert
training-case mask. A candidate is a model label 2, not a cancer diagnosis.
Private, isolated, rights-cleared PUBLIC research only. No weights downloaded.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import platform
from pathlib import Path

TASK="pancreatic_tumor"
SCHEMA="opus-real-monai-pancreatic-tumor-source-candidates/v1"
VERSION="1.5.1"
AUTH="PUBLIC-ABDOMINAL-CT-RESEARCH-OK"
MIN_RAM=12*1024**3
MAX_NATIVE=150_000_000
MAX_RESAMPLED=120_000_000

def digest(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
    return h.hexdigest()

def model_and_source(source,checkpoint,expected_sha,admission):
    import nibabel as nib
    import numpy as np
    from abdominal_ct_pathology_inference import inspect_admission
    s,w=Path(source),Path(checkpoint)
    if (s.is_symlink() or w.is_symlink() or not s.is_file() or not w.is_file() or
        s.suffix!=".nii" or w.suffix!=".ts" or
        not 1024**2<w.stat().st_size<1024**3 or
        not isinstance(expected_sha,str) or len(expected_sha)!=64 or
        digest(w)!=expected_sha):
        raise ValueError("pinned_original_pancreas_torchscript_unverified")
    source_sha=digest(s)
    inspect_admission(admission,TASK,source_sha)
    image=nib.load(str(s),mmap=True)
    if (image.ndim!=3 or math.prod(image.shape)>MAX_NATIVE or
        min(image.shape)<8 or image.header.get_xyzt_units()[0]!="mm" or
        not np.isfinite(image.affine).all() or
        abs(float(np.linalg.det(image.affine[:3,:3])))<1e-6):
        raise ValueError("invalid_original_CT_native_physical_geometry")
    return image,source_sha

def native_candidates(labels,affine):
    """True original-model class 2 connected components, not expert-confirmed."""
    import numpy as np
    from scipy import ndimage
    x=np.asarray(labels)
    if (x.ndim!=3 or x.size>MAX_NATIVE or
        x.dtype.kind not in ("i","u") or not np.isin(x,[0,1,2]).all()):
        raise ValueError("unknown_trained_pancreas_model_class")
    a=np.asarray(affine,dtype=float)
    if a.shape!=(4,4) or not np.isfinite(a).all():
        raise ValueError("original_CT_native_affine_invalid")
    objects,count=ndimage.label(x==2,structure=ndimage.generate_binary_structure(3,2))
    if count>100000:raise ValueError("excessive_prediction_components")
    voxel_ml=abs(float(np.linalg.det(a[:3,:3])))/1000.
    result=[]
    for label,box in enumerate(ndimage.find_objects(objects),1):
        if box is None:continue
        block=objects[box]==label
        n=int(np.count_nonzero(block))
        if n<10:continue
        coords=np.array(ndimage.center_of_mass(block),dtype=float)+[sl.start for sl in box]
        world=(a@np.r_[coords,1])[:3]
        result.append({
          "nativeSourceVoxelBoxIJK":[[int(sl.start),int(sl.stop)-1] for sl in box],
          "nativeSourceCentroidIJK":[round(float(v),3) for v in coords],
          "worldRasCentroidMm":[round(float(v),3) for v in world],
          "candidateVoxelCount":n,"candidateVolumeMl":round(n*voxel_ml,5),
          "clinicalPancreaticCancerConfirmed":False,
        })
        if len(result)>128:raise ValueError("excessive_lesions_to_review")
    result.sort(key=lambda x:x["candidateVoxelCount"],reverse=True)
    return result

def run(source,checkpoint,expected_sha,admission,output,authorization):
    if authorization!=AUTH:
        raise ValueError("public_nonpatient_model_execution_authorization_required")
    import psutil
    if (platform.system()!="Linux" or
        importlib.metadata.version("monai") not in ("1.5.1","1.5.0") or
        psutil.virtual_memory().available<MIN_RAM):
        raise ValueError("original_monai_cpu_linux_min12GiB_runtime_unavailable")
    source=Path(source);output=Path(output)
    if output.exists() or output.is_symlink() or output.suffix!=".json":
        raise ValueError("new_private_report_path_required")
    image,source_sha=model_and_source(source,checkpoint,expected_sha,admission)
    from nibabel.processing import resample_to_output,resample_from_to
    import nibabel as nib
    import numpy as np
    import torch
    from monai.inferers import sliding_window_inference

    # Identical transformations to successful real MSD MONAI DiNTS study:
    # closest RAS, isotropic 1mm, HU [-87,199] -> [0,1], 96^3 window.
    canonical=nib.as_closest_canonical(image)
    resampled=resample_to_output(canonical,voxel_sizes=(1.,1.,1.),order=1)
    if math.prod(resampled.shape)>MAX_RESAMPLED:
        raise ValueError("native_CT_1mm_resampling_exceeds_linux_worker_budget")
    scan=np.asarray(resampled.dataobj,dtype=np.float32)
    if not np.isfinite(scan).all():
        raise ValueError("CT_nonfinite_HU")
    scan=np.clip((scan+87.)/286.,0.,1.)
    torch.set_num_threads(2)
    model=torch.jit.load(str(checkpoint),map_location="cpu")
    model.eval()
    with torch.inference_mode():
        input_tensor=torch.from_numpy(np.ascontiguousarray(scan[None,None]))
        prediction=sliding_window_inference(
          input_tensor,roi_size=(96,96,96),sw_batch_size=1,predictor=model,
          overlap=0.25,sw_device=torch.device("cpu"),device=torch.device("cpu"))
        if isinstance(prediction,(tuple,list)):prediction=prediction[0]
        if prediction.ndim!=5 or prediction.shape[1]!=3:
            raise ValueError("unexpected_original_DiNTS_three_class_logits")
        predicted=prediction.argmax(dim=1)[0].cpu().numpy().astype(np.uint8)
    del scan,input_tensor,prediction
    native=nib.Nifti1Image(predicted,resampled.affine)
    mapped=resample_from_to(native,image,order=0)
    labels=np.asarray(mapped.dataobj,dtype=np.uint8)
    if labels.shape!=image.shape or not np.isin(labels,[0,1,2]).all():
        raise ValueError("trained_model_output_not_native_CT_registered")
    for i in (0,image.shape[0]-1):
        for j in (0,image.shape[1]-1):
            for k in (0,image.shape[2]-1):
                v=np.array([i,j,k,1.])
                if np.linalg.norm((image.affine@v)[:3]-(mapped.affine@v)[:3])>.05:
                    raise ValueError("native_CT_spatial_grid_mismatch")
    lesions=native_candidates(labels,image.affine)
    report={
      "schema":SCHEMA,"task":TASK,
      "model":"MONAI pancreas_ct_dints_segmentation official pretrained TorchScript",
      "modelCheckpointFileSha256":expected_sha,
      "vendorInternalActiveWeightsProof":False,
      "monaiVersion":importlib.metadata.version("monai"),
      "sourceNiftiSha256":source_sha,
      "nativeSourceDimensionsXYZ":list(image.shape),
      "nativeSourceVoxelVolumeMl":abs(float(np.linalg.det(image.affine[:3,:3])))/1000,
      "sourceSpatialCornersMatchedMaxMm":0.05,
      "sourceNativeTumorVoxelCount":int(np.count_nonzero(labels==2)),
      "tumorCandidateComponents":lesions,
      "actualPretrainedModelForwardCompleted":True,
      "preprocessing":"RAS canonical;1mm;HU[-87,199]->[0,1];ROI96^3 overlap0.25",
      "originalPublisherOverlap":0.625,"exactPublisherInferenceReproduced":False,
      "clinicalValidation":False,"negativeCancerDiagnosisPermitted":False,
      "originalDicomSopRegistrationVerified":False,
      "limitations":[
        "Original model weight FILE digest verified, not internal torch.jit.load parameter identity.",
        "Candidate class 2 may be false positive or miss tumor; no independent accuracy validation.",
        "CPU overlap 0.25 differs from publisher 0.625.",
        "Native source NIfTI voxel indices require original SOP mapping before clinical attribution.",
        "Operator authorizes rights-cleared public nonpatient CT; not a patient-care service.",
      ]
    }
    output.write_text(json.dumps(report,indent=2))
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for key in ("source","checkpoint","checkpoint-sha256","source-admission",
                "output-json","authorization"):
        p.add_argument("--"+key,required=True)
    a=p.parse_args()
    report=run(a.source,a.checkpoint,a.checkpoint_sha256,a.source_admission,
               a.output_json,a.authorization)
    print(json.dumps({k:report[k] for k in
      ("task","sourceNiftiSha256","sourceNativeTumorVoxelCount",
       "actualPretrainedModelForwardCompleted","clinicalValidation")}))
if __name__=="__main__":
    main()
