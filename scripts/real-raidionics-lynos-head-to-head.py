#!/usr/bin/env python3
"""One real source-matched LyNoS CT: original Bouget vs Raidionics ONNX nodes.

Research only. No fake weights, no expert ROI as model input, no clinical claims.
Bouget's authentic CT_Lungs stage supplies a SAME-CT lung prior. The modern
ONNX model then processes the original (not expert-cropped) CT. Expert lymph
node masks are used strictly AFTER both independent trained forwards.
Source MRI/CT/pixel/model assets never become GitHub artifacts.
"""
from __future__ import annotations
import argparse
import configparser
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil

PUBLIC_CT_SHA = "d918d73688c38be7550a59e881e6a72b617f4d8f4171e99b286afb89f27ce646"
PUBLIC_NODE_EXPERT_SHA = "9f24068288b5fab6cae9f348dfbb858e2bc6cfd5e5638769c670552e6b63170b"
PUBLISHER_BOU_GET_ARCHIVE_SHA = "e00d3c83aed6ba7fc0cd376e20e4aa3ec8a672d1737a0fc41becc8d217449d72"
PUBLISHER_RAIDIONICS_ONNX_SHA = "922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08"
LUNG_PRIOR_THRESHOLD = .4  # Bouget original runtime threshold; NOT expert data
MAX_CT_VOXELS = 180_000_000


def loaded_script(name: str):
    path = Path(__file__).with_name(name)
    spec = importlib.util.spec_from_file_location(name.replace(".", "_").replace("-", "_"), path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def stage_same_ct_original_lung_prior(
        source_ct: Path, expert_nodes: Path, bouget_lung: Path,
        new_input_dir: Path) -> dict:
    import nibabel as nib
    import numpy as np

    if new_input_dir.exists() or not new_input_dir.parent.is_dir():
        raise ValueError("fresh_raidionics_LyNoS_input_dir_required")
    original = nib.load(str(source_ct))
    ground_truth = nib.load(str(expert_nodes))
    lung = nib.load(str(bouget_lung))
    if (len(original.shape) != 3 or original.shape != ground_truth.shape
            or original.shape != lung.shape
            or np.prod(original.shape, dtype=np.int64) > MAX_CT_VOXELS
            or not np.isfinite(original.affine).all()
            or not np.allclose(original.affine, ground_truth.affine, rtol=0, atol=.03)
            or not np.allclose(original.affine, lung.affine, rtol=0, atol=.03)):
        raise ValueError("original_LyNoS_CT_expert_lung_native_geometry_not_matching")
    def sha(path):
        hasher=hashlib.sha256()
        with path.open("rb") as inp:
            for chunk in iter(lambda:inp.read(1024*1024),b""):
                hasher.update(chunk)
        return hasher.hexdigest()
    if sha(source_ct) != PUBLIC_CT_SHA:
        raise ValueError("real_LyNoS_source_CT_sha_mismatch")
    if sha(expert_nodes) != PUBLIC_NODE_EXPERT_SHA:
        raise ValueError("real_LyNoS_expert_node_mask_SHA_mismatch")
    # The manual lymph-node expert mask must never influence the lung prior.
    prior = np.asarray(lung.dataobj, dtype=np.float32)
    if (not np.isfinite(prior).all() or prior.min() < -1e-5
            or prior.max() > 1+1e-5):
        raise ValueError("original_Bouget_lung_prior_not_a_probability_volume")
    binary = (prior >= LUNG_PRIOR_THRESHOLD).astype(np.uint8)
    lung_voxels = int(np.count_nonzero(binary))
    if lung_voxels < 10_000 or lung_voxels >= binary.size:
        raise ValueError("same_CT_original_Bouget_lung_prior_empty_or_unbounded")
    new_input_dir.mkdir(mode=0o700)
    new_ct = new_input_dir/"input0.nii.gz"
    new_lung = new_input_dir/"input0_label_lungs.nii.gz"
    shutil.copyfile(source_ct,new_ct)
    nib.save(nib.Nifti1Image(binary,original.affine,header=original.header.copy()),str(new_lung))
    if sha(new_ct) != PUBLIC_CT_SHA:
        raise ValueError("staged_original_CT_sha_changed")
    check=nib.load(str(new_lung))
    if (check.shape != original.shape or
            not np.allclose(check.affine, original.affine,rtol=0,atol=.03)):
        raise ValueError("stage_lung_native_affine_mismatch")
    return {
        "originalCTSHA256":sha(new_ct),
        "originalExpertNodesSHA256":sha(expert_nodes),
        "trainedBougetLungPriorRawSHA256":sha(bouget_lung),
        "raidionicsInputLungMaskSHA256":sha(new_lung),
        "originalSAME_CT_LungPriorVoxels":lung_voxels,
        "lungPriorIsIndependentExpertTruth":False,
        "expertNodeLabelsUsedForModelInference":False,
        "sourceShape":list(original.shape),
        "lungsPath":str(new_lung),
        "ctPath":str(new_ct),
    }


def run(work:Path, report:Path):
    import nibabel as nib
    if (work.exists() or report.exists() or report.is_symlink()
            or not work.parent.is_dir() or not report.parent.is_dir()):
        raise ValueError("new_private_head_to_head_workspace_and_report_required")
    work.mkdir(mode=0o700)
    bouget = loaded_script("real-bouget-sw32-lynos-ct-cpu.py")
    raid = loaded_script("real-raidionics-mediastinal-onnx-cpu.py")
    if (bouget.PINNED_IMAGE_SHA256 != PUBLIC_CT_SHA
            or bouget.PINNED_PUBLISHER_ZIP_SHA256 != PUBLISHER_BOU_GET_ARCHIVE_SHA
            or raid.MODEL_SHA256 != PUBLISHER_RAIDIONICS_ONNX_SHA):
        raise ValueError("original_pretrained_model_or_source_provenance_drift")
    base = work/"bouget"
    bouget_report = bouget.run_case(base)
    if (not bouget_report["wholeCTOriginalModelForwardCompleted"]
            or bouget_report["originalPublicCtSHA256"] != PUBLIC_CT_SHA):
        raise ValueError("first_original_Bouget_model_real_forward_missing")
    source_ct=base/"resources/data"/"pat3_data.nii.gz"
    expert=base/"resources/data"/"pat3_labels_LymphNodes.nii.gz"
    prior=base/"resources/output"/"lynos-pat3-pred_Lungs.nii.gz"
    if not prior.is_file():
        raise ValueError("original_Bouget_CT_Lungs_probability_file_missing")
    onnx_work=work/"raidionics"
    onnx_work.mkdir(mode=0o700)
    raid.prepare(onnx_work)  # vendor pinned real ONNX + vendor reference verified
    staged=stage_same_ct_original_lung_prior(source_ct,expert,prior,onnx_work/"lynos-input")
    cfg_path=onnx_work/"original-model-config.ini"
    config=configparser.ConfigParser()
    if not config.read(cfg_path):
        raise ValueError("publisher_raidionics_preprocessing_config_missing")
    config["System"]["inputs_folder"]=str((onnx_work/"lynos-input").resolve())
    config["Mediastinum"]["lungs_segmentation_filename"]=str(
        (onnx_work/"lynos-input/input0_label_lungs.nii.gz").resolve())
    with cfg_path.open("w",encoding="utf-8") as handle:
        config.write(handle)
    meta_path=onnx_work/"verified-original-source.json"
    meta=json.loads(meta_path.read_text())
    if meta["originalModelSHA256"] != PUBLISHER_RAIDIONICS_ONNX_SHA:
        raise ValueError("second_original_Raidionics_ONNX_weights_unverified")
    meta.update({"sourceSha256":staged["originalCTSHA256"],
                 "lungMaskSha256":staged["raidionicsInputLungMaskSHA256"],
                 "sourceShape":staged["sourceShape"],
                 "sampleType":"original_LyNoS_Pat3_real_positive_with_Bouget_Lungs_prior",
                 "sourceExpertSha256":staged["originalExpertNodesSHA256"],
                 "originalForwardProtocol":"real_pat3_no_expert_mask_in_model_input"})
    meta_path.write_text(json.dumps(meta,indent=2)+"\n")
    raid.inference(onnx_work)  # genuine author ONNX on LyNoS, NOT vendor smoke data
    original_pred=onnx_work/"outputs/labels_LymphNodes.nii.gz"
    if not original_pred.is_file():
        raise ValueError("original_Raidionics_LymphNodes_ONNX_result_missing")
    # Explicitly check mask/source/expert SAME native grid before scoring.
    modern = bouget.metrics(original_pred, expert, source_ct)
    first = bouget_report
    if modern["sourceCTSHA256"] != PUBLIC_CT_SHA or modern["expertLabelSHA256"] != PUBLIC_NODE_EXPERT_SHA:
        raise ValueError("head_to_head_evaluations_not_same_CT_and_expert")
    result={
        "schema":"opus-genuine-Bouget-vs-Raidionics-LyNoS-Pat3-research/v1",
        "source":"andreped/LyNoS original Pat3 publicly published CT",
        "caseCount":1,
        "modelTrainingOverlapIndependentlyExcluded":False,
        "clinicalValidation":False,"clinicallyValidated":False,
        "patientCloudTransfer":False,"gpuUsed":False,
        "originalLyNoSContrastCTSHA256":PUBLIC_CT_SHA,
        "originalLyNoSExpertNodeLabelSHA256":PUBLIC_NODE_EXPERT_SHA,
        "originalBougetPublisherArchiveSHA256":PUBLISHER_BOU_GET_ARCHIVE_SHA,
        "originalRaidionicsONNXPublisherArchiveSHA256":PUBLISHER_RAIDIONICS_ONNX_SHA,
        "model1":"Original Bouget UNet-SW32","model1Metrics":first,
        "model2":"Original Raidionics CT_LymphNodes ONNX v13",
        "model2Metrics":modern,
        "sourceBoundLungPrior":{
            k:v for k,v in staged.items() if k not in ("ctPath","lungsPath")
        },
        "originalModel2TrainedForwardCompleted":True,
        "sourceAndExpertAreExactSameCTForBothModels":True,
        "allDisplayedNodeMetricsAreResearchOnly":True,
        "physicianMustReviewOriginalImages":True,
        "lowDiceDoesNotExcludeLymphadenopathy":True
    }
    report.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"realSourceBoundTwoOriginalModelForwards":True,
                      "bougetDice":first["voxelDice"],
                      "raidionicsDice":modern["voxelDice"],
                      "bougetTPFPFN":[first["TP"],first["FP"],first["FN"]],
                      "raidionicsTPFPFN":[modern["TP"],modern["FP"],modern["FN"]],
                      "independentClinicalValidation":False}))


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--workdir",type=Path,required=True)
    p.add_argument("--report",type=Path,required=True)
    args=p.parse_args()
    run(args.workdir,args.report)

if __name__=="__main__":
    main()
