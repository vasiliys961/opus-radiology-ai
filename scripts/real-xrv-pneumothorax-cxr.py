#!/usr/bin/env python3
"""Genuine TorchXRayVision NIH pretrained research CXR pneumothorax classifier.

Loads an official preinstalled pretrained checkpoint in a separate Linux research
environment. Does NOT localise pneumothorax or rule out disease.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

SCHEMA="opus-xrv-nih-cxr-multitask-pretrained/v2"
ADDITIONAL_TARGETS=("Cardiomegaly","Effusion","Pneumonia","Edema","Mass")
VERSION="1.5.7"
MODEL="densenet121-res224-nih"
FILENAME="nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt"
SOURCE="https://github.com/mlmed/torchxrayvision/releases/tag/v1"
MAX_PNG_BYTES=25*1024*1024

def sha256(path):
    h=hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(1048576),b""):
            h.update(block)
    return h.hexdigest()

def validate_source(image,weight_file,output,expected_sha,source_url,source_terms):
    if source_terms!="NIH Clinical Center ChestXray FAQ":
        raise ValueError("NIH_public_CXR_license_and_attribution_must_be_confirmed")
    if (not source_url.startswith("https://") or len(source_url)>1024
        or any(c in source_url for c in "@?#")):
        raise ValueError("source_URL_missing_or_contains_identifier")
    if (image.is_symlink() or not image.is_file() or image.suffix.lower()!=".png"
        or not 1024<=image.stat().st_size<=MAX_PNG_BYTES):
        raise ValueError("public_standalone_png_required_no_patient_DICOM")
    if (weight_file.is_symlink() or not weight_file.is_file()
        or weight_file.name!=FILENAME
        or not 10*1024**2 <= weight_file.stat().st_size <= 90*1024**2):
        raise ValueError("original_pretrained_NIH_checkpoint_file_required")
    if (len(expected_sha)!=64 or any(c not in "0123456789abcdef" for c in expected_sha)
        or sha256(weight_file)!=expected_sha):
        raise ValueError("original_checkpoint_SHA256_mismatch")
    if output.exists() or output.is_symlink() or output.suffix!=".json" or not output.parent.is_dir():
        raise ValueError("new_numeric_only_JSON_output_required")

def validate_model_output(model_pathologies,scores):
    import numpy as np
    if not isinstance(model_pathologies,(tuple,list)) or model_pathologies.count("Pneumothorax")!=1:
        raise ValueError("pretrained_model_has_no_unique_pneumothorax_output")
    idx=model_pathologies.index("Pneumothorax")
    a=np.asarray(scores,dtype=float)
    if a.ndim!=1 or a.shape[0]!=len(model_pathologies) or not np.isfinite(a[idx]):
        raise ValueError("malformed_genuine_pneumothorax_output")
    if not 0<=a[idx]<=1:
        raise ValueError("model_pneumothorax_score_not_in_0_1")
    return float(a[idx])

def additional_trained_nih_scores(model_labels,values,publisher_labels):
    """Never expose an NIH model output not explicitly trained for this target."""
    import numpy as np
    out=np.asarray(values,dtype=float)
    if out.ndim!=1 or out.size!=len(model_labels):
        raise ValueError("invalid_multitask_model_output_shape")
    result={}
    for name in ADDITIONAL_TARGETS:
        if publisher_labels.count(name)!=1 or model_labels.count(name)!=1:
            raise ValueError("untrained_or_ambiguous_NIH_pathology_head")
        score=float(out[model_labels.index(name)])
        if not np.isfinite(score) or not 0<=score<=1:
            raise ValueError("nonfinite_or_unbounded_NIH_pathology_score")
        result[name]=round(score,6)
    return result

def run(image,weights,output,expected_sha,source_url,source_terms):
    import numpy as np
    import torch
    import torchxrayvision as xrv
    from skimage import io
    if sys.platform!="linux":
        raise RuntimeError("isolated_Linux_CPU_research_server_required_no_Mac_patient_mode")
    validate_source(image,weights,output,expected_sha,source_url,source_terms)
    if importlib.metadata.version("torchxrayvision")!=VERSION:
        raise ValueError("unsupported_torchxrayvision_upstream_version")
    reference=xrv.models.model_urls[MODEL]
    if (any(reference["labels"].count(name)!=1 for name in ("Pneumothorax",*ADDITIONAL_TARGETS))
        or reference["weights_url"].rsplit("/",1)[-1]!=FILENAME):
        raise ValueError("original_NIH_pretrained_labels_or_weights_changed")
    x=io.imread(str(image))
    if x.ndim not in (2,3) or x.shape[0]<128 or x.shape[1]<128 or x.size>4096*4096*4:
        raise ValueError("unsupported_CXR_geometry")
    if x.dtype!=np.uint8:
        raise ValueError("non_8bit_publisher_CXR_without_known_calibration")
    data=xrv.datasets.normalize(x,255)
    if data.ndim==3:
        if data.shape[2] not in (3,4):
            raise ValueError("unrecognised_chest_radiograph_channels")
        data=data[:,:,:3].mean(axis=2)
    if data.ndim!=2:
        raise ValueError("radiograph_not_two_dimensional")
    data=data[None,...]
    transform=xrv.datasets.XRayCenterCrop()
    data=transform(data)
    data=xrv.datasets.XRayResizer(224)(data)
    if data.shape!=(1,224,224):
        raise ValueError("pretrained_image_preprocessing_invalid")
    with tempfile.TemporaryDirectory(prefix="opus-xrv-public-") as directory:
        cached=Path(directory)/FILENAME
        shutil.copyfile(weights,cached)
        if sha256(cached)!=expected_sha:
            raise ValueError("cached_NIH_checkpoint_hash_mismatch")
        # NOTE: XRV uses torch.load(... weights_only=False) for old model objects.
        # This method must run ONLY on the intentionally isolated, trusted research worker.
        model=xrv.models.DenseNet(weights=MODEL,cache_dir=directory)
        model.eval()
        if model.pathologies.count("Pneumothorax")!=1:
            raise ValueError("loaded_classifier_no_unique_target")
        torch.set_num_threads(2)
        with torch.no_grad():
            pred=model(torch.from_numpy(data).float()[None,...]).cpu().numpy()
        if pred.shape!=(1,len(model.pathologies)):
            raise ValueError("unexpected_genuine_model_output_shape")
        score=validate_model_output(model.pathologies,pred[0])
        additional_scores=additional_trained_nih_scores(model.pathologies,pred[0],reference["labels"])
    report={
        "schema":SCHEMA,
        "modality":"CR/DX",
        "researchTask":"pneumothorax_image_level_screen_candidate",
        "originalModel":"TorchXRayVision NIH DenseNet121",
        "modelId":MODEL,"originalModelLibrary":VERSION,
        "modelPublisherURL":SOURCE,
        "originalTrainedCheckpointSHA256":expected_sha,
        "originalSourceRadiographSHA256":sha256(image),
        "originalSourceURL":source_url,"sourceTerms":source_terms,
        "actualPretrainedModelForwardCompleted":True,
        "uncalibratedPneumothoraxImageLevelScore":round(score,6),
        "uncalibratedAdditionalPublisherTrainedImageLevelScores":additional_scores,
        "cardiomegalySpatialLocalization":None,
        "pleuralEffusionSpatialLocalization":None,
        "pneumoniaSpatialLocalization":None,
        "pulmonaryEdemaSpatialLocalization":None,
        "lungMassSpatialLocalization":None,
        "cardiomegalyDiagnosis":None,"pleuralEffusionDiagnosis":None,
        "pneumoniaDiagnosis":None,"pulmonaryEdemaDiagnosis":None,"lungMassDiagnosis":None,
        "pneumothoraxSpatialLocalization":None,
        "radiologistReferenceDiagnosisAvailable":False,
        "expertAccuracyMetrics":None,
        "pneumothoraxDiagnosis":None,
        "absenceOfDiseaseEstablished":False,
        "researchOnly":True,"patientUseAllowed":False,
        "limitations":[
            "Model trained on NIH ChestXray: publisher sample may overlap model training.",
            "Score is an uncalibrated image-level model output, not pathology probability.",
            "No spatial coordinates/measurements for pneumothorax, cardiomegaly or effusion.",
            "Cardiomegaly, effusion, pneumonia, pulmonary edema and mass scores are uncalibrated NIH model outputs, not diagnoses.",
            "Image-level scores cannot resolve a mass from consolidation, classify diffuse edema or spatially localize a lesion.",
            "No original independent expert-positive validation, sensitivity or specificity.",
            "Original pretrained PyTorch checkpoint uses legacy pickle: trusted isolated Linux only.",
            "No patient images, DICOM identifiers or cloud LLM transmission."
        ]
    }
    output.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    return report

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name in ("image","weights","output"):
        p.add_argument("--"+name,type=Path,required=True)
    p.add_argument("--weights-sha256",required=True)
    p.add_argument("--source-url",required=True)
    p.add_argument("--source-terms",required=True)
    p.add_argument("--public-deidentified-licensed-research-only",action="store_true")
    a=p.parse_args()
    if not a.public_deidentified_licensed_research_only:
        p.error("Research only: legally usable deidentified public image, never patient input")
    r=run(a.image,a.weights,a.output,a.weights_sha256,a.source_url,a.source_terms)
    print(json.dumps({"schema":SCHEMA,
                      "additionalPublisherTrainedTargets":list(r["uncalibratedAdditionalPublisherTrainedImageLevelScores"]),
                      "realPretrainedInference":r["actualPretrainedModelForwardCompleted"],
                      "researchOnly":True}))

if __name__=="__main__":main()
