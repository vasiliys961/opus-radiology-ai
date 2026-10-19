#!/usr/bin/env python3
"""Genuine AI-CAC v1.0.0 weights -> one unchanged original TCIA LCTSC CT slice.

Technical smoke ONLY: LCTSC is NOT proven nongated noncontrast, no CAC expert
truth, no entire CT inference, no Agatston or clinical claim. No source pixels
or identifier data in numeric output or GitHub artifacts.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
import os
from pathlib import Path
import resource
import time

def import_app():
    spec=importlib.util.spec_from_file_location(
        "ai_cac",Path(__file__).with_name("real-ai-cac-public-ct.py"))
    app=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(app)
    return app

def true_linux_cgroup_ram_limit():
    caps=[]
    for path in ("/sys/fs/cgroup/memory.max",
                 "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        p=Path(path)
        if p.is_file():
            data=p.read_text().strip()
            if data.isdigit() and int(data) < 2**60:
                caps.append(int(data))
    mem=Path("/proc/meminfo")
    if mem.is_file():
        mem_total=int(next(x.split()[1] for x in mem.read_text().splitlines()
                           if x.startswith("MemTotal:")))*1024
        caps.append(mem_total)
    return min(caps) if caps else 0

def run(source,model_dir,output):
    import numpy as np
    import torch
    import pydicom
    from monai.networks.nets import SwinUNETR
    app=import_app()
    if output.exists() or output.is_symlink():
        raise ValueError("refuse_overwrite_of_numeric_real_model_report")
    if not (source/"reference.json").is_file():
        raise ValueError("original_pinned_TCIA_LCTSC_manifest_required")
    m=json.loads((source/"reference.json").read_text())
    if (m.get("schema")!="opus-r231-browser-reference/v1" or
        m.get("sourceContentChainSha256") !=
        "bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61" or
        m.get("selectedFrames") != 103 or
        m.get("allSourceFrames") is not True or
        m.get("selectedIndicesZeroBased") != [0,102]):
        raise ValueError("not_entire_103_original_public_LCTSC_CT")
    orig=app.select_public_ct_slices(source/"dicom")
    weights,manifest=app.verify_weights(model_dir)
    assert orig["shape"] == (512,512,103)
    cap=true_linux_cgroup_ram_limit()
    # Experimental separate ephemeral GitHub runner, not the Opus Mac:
    # do not launch on a constrained memory host.
    if cap < 6*1024**3:
        raise RuntimeError("at_least_6GiB_hard_ram_limit_for_single_slice_smoke")
    start=time.monotonic()
    torch.set_num_threads(2)
    model=SwinUNETR(
        spatial_dims=2,img_size=(512,512),in_channels=1,
        out_channels=1,feature_size=96,use_checkpoint=True,drop_rate=0.2)
    loaded=torch.load(str(weights),map_location="cpu",weights_only=True)
    if not isinstance(loaded,dict) or not isinstance(loaded.get("model_state_dict"),dict):
        raise ValueError("not_original_publisher_AI_CAC_checkpoint_structure")
    sd=loaded["model_state_dict"]
    if not sd or any(not k.startswith("module.") for k in sd):
        raise ValueError("trained_vendor_DataParallel_checkpoint_keys_changed")
    model.load_state_dict({k[7:]:v for k,v in sd.items()},strict=True)
    del loaded,sd
    model.eval()
    # Select one authentic source slice; NO source pixels or filename in report.
    slice_index=len(orig["files"])//2
    d=pydicom.dcmread(str(orig["files"][slice_index]))
    hu=d.pixel_array.astype(np.float32)*float(d.RescaleSlope)+float(d.RescaleIntercept)
    if hu.shape!=(512,512) or not np.isfinite(hu).all():
        raise ValueError("not_original_unmodified_CT_quantitative_pixels")
    with torch.inference_mode():
        output_tensor=model(torch.from_numpy(hu[None,None]))
        if (output_tensor.shape!=(1,1,512,512)
            or not torch.isfinite(output_tensor).all()):
            raise ValueError("actual_AI_CAC_pretrained_output_invalid")
        positive=int(torch.count_nonzero(output_tensor>0).item())
        min_logit=float(output_tensor.min().item())
        max_logit=float(output_tensor.max().item())
    result={
      "schema":"opus-ai-cac-real-publisher-lctsc-one-slice-smoke/v1",
      "model":"Raffi-Hagopian/AI-CAC",
      "officialVersion":"v1.0.0",
      "officialCheckpointSha256":manifest["checkpointSha256Observed"],
      "originalTCIACollection":"LCTSC","originalCTLicense":"CC BY 3.0",
      "originalFullSourceSeriesHashChainSha256":orig["sourceSha256"],
      "fullNativeCTSliceCount":103,"actualOriginalSliceInferredCount":1,
      "originalSliceDimensions":[512,512],
      "truePublishedPretrainedCheckpointInferenceCompleted":True,
      "outputShape":[1,1,512,512],
      "predictedPositivePixelsSingleSlice":positive,
      "observedOutputRange":[round(min_logit,5),round(max_logit,5)],
      "elapsedSeconds":round(time.monotonic()-start,3),
      "maxResidentSetKiB":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
      "fullDICOMSeriesCACScore":None,"native3DLesionLocations":None,
      "originalSourceProtocolConfirmedSuitableForCAC":False,
      "expertCoronaryCalciumReference":False,
      "clinicalDetectionAccuracyProven":False,
      "patientUseAllowed":False,
      "limitations":[
        "Actual publisher weights and real public LCTSC CT slice, but unknown contrast/protocol suitability.",
        "Single slice is only an execution smoke, NOT a complete CAC CT scan analysis.",
        "No expert coronary calcium mask; not Dice, sensitivity, Agatston or negative study.",
        "Host performance does not establish Mac M1 8 GiB safety."
      ]
    }
    output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({k:result[k] for k in
        ("officialVersion","truePublishedPretrainedCheckpointInferenceCompleted",
        "fullNativeCTSliceCount","actualOriginalSliceInferredCount",
        "predictedPositivePixelsSingleSlice","elapsedSeconds",
        "maxResidentSetKiB","clinicalDetectionAccuracyProven")}))
    
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--source",type=Path,required=True)
    parser.add_argument("--models",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    a=parser.parse_args()
    run(a.source,a.models,a.output)

if __name__=="__main__":
    main()
