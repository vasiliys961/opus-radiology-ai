#!/usr/bin/env python3
"""Original MSD colon-cancer CT -> ORIGINAL pretrained VISTA3D label 27 -> expert comparison.

Research only. Real inference is opt-in and requires a separate >=14 GiB CUDA GPU.
Dataset license CC BY-SA 4.0; MONAI code Apache 2.0, NVIDIA model weights
NON-COMMERCIAL research/evaluation only. Never run against real patients.
No result is emitted unless an actual checkpoint and source-bound mask exist.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

DATASET = "MedOtter/msd-colon"
DATASET_REV = "59253d1"
MODEL = "MONAI/vista3d"
MODEL_REV = "c6dbe15"
LABEL = 27  # MONAI VISTA3D "colon cancer primaries", NOT ordinary colon
CASES = ("141", "046", "050", "165")
SCHEMA = "opus-msd-colon-real-vista3d-expert-v1"
MAX_BYTES = 350 * 1024**2
MAX_VOXELS = 150_000_000


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def _bounded(path: Path, limit: int = MAX_BYTES) -> None:
    if path.is_symlink() or not path.is_file() or not (1024 <= path.stat().st_size <= limit):
        raise ValueError("source_or_checkpoint_missing_or_unbounded")


def verify_pair(ct_path: Path, expert_path: Path):
    import nibabel as nib
    import numpy as np

    _bounded(ct_path)
    _bounded(expert_path)
    ct = nib.load(str(ct_path))
    expert = nib.load(str(expert_path))
    if (ct.ndim != 3 or expert.ndim != 3 or ct.shape != expert.shape
            or any(not 32 <= n <= 850 for n in ct.shape)
            or math.prod(ct.shape) > MAX_VOXELS
            or not np.isfinite(ct.affine).all()
            or abs(float(np.linalg.det(ct.affine[:3, :3]))) < 0.00001
            or not np.allclose(ct.affine, expert.affine, rtol=0, atol=0.05)):
        raise ValueError("original_colon_CT_and_expert_mask_geometry_mismatch")
    label = np.asarray(expert.dataobj)
    if expert.header.get_data_dtype().kind not in "ui" or not np.isin(label, (0, 1)).all():
        raise ValueError("MSD_Task10_expert_labels_not_binary")
    if ct.header.get_xyzt_units()[0] != "mm":
        raise ValueError("CT_spatial_units_not_mm")
    return ct, int(np.count_nonzero(label))


def prepare(work: Path):
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    import shutil

    if work.exists():
        raise ValueError("research_work_directory_must_be_new")
    api = HfApi(token=False)
    dataset = api.repo_info(DATASET, repo_type="dataset", revision=DATASET_REV, token=False)
    model = api.model_info(MODEL, revision=MODEL_REV, token=False)
    if (len(dataset.sha) != 40 or not dataset.sha.startswith(DATASET_REV)
            or len(model.sha) != 40 or not model.sha.startswith(MODEL_REV)):
        raise ValueError("immutable_public_model_and_dataset_revisions_not_resolved")
    work.mkdir(parents=True, mode=0o700)
    for case in CASES:
        filename = f"colon_{case}.nii.gz"
        for target, folder in (("ct.nii.gz", "imagesTr"), ("expert.nii.gz", "labelsTr")):
            remote = Path(hf_hub_download(
                repo_id=DATASET, repo_type="dataset", revision=dataset.sha,
                filename=f"{folder}/{filename}", token=False))
            _bounded(remote)
            shutil.copyfile(remote, work / target)
        ct, voxels = verify_pair(work / "ct.nii.gz", work / "expert.nii.gz")
        if voxels:
            break
        (work / "ct.nii.gz").unlink()
        (work / "expert.nii.gz").unlink()
    else:
        raise ValueError("no_expert_positive_colon_cancer_case_in_public_shortlist")

    bundle = Path(snapshot_download(
        repo_id=MODEL, revision=model.sha, token=False, local_dir=work / "bundle",
        allow_patterns=["LICENSE", "configs/*.json", "configs/*.conf",
                        "scripts/*.py", "models/model.pt"]))
    weights = bundle / "models/model.pt"
    _bounded(weights, limit=1100 * 1024**2)
    for file in ("configs/inference.json", "configs/metadata.json",
                 "scripts/evaluator.py", "scripts/inferer.py", "LICENSE"):
        if not (bundle / file).is_file():
            raise ValueError(f"official_VISTA3D_bundle_incomplete:{file}")
    license_text = (bundle / "LICENSE").read_text()
    if "Model Weights License" not in license_text or "non-commercially" not in license_text:
        raise ValueError("NVIDIA_research_only_weight_license_not_verified")
    record = {
        "schema": "opus-colon-vista3d-admission-v1",
        "dataset": DATASET, "datasetRevisionSha": dataset.sha,
        "datasetLicense": "CC-BY-SA-4.0",
        "sourceName": filename, "sourceSha256": sha256(work / "ct.nii.gz"),
        "expertMaskSha256": sha256(work / "expert.nii.gz"),
        "expertTumorVoxels": voxels, "originalNativeShape": list(ct.shape),
        "model": MODEL, "modelRevisionSha": model.sha,
        "officialWeightsSha256": sha256(weights),
        "officialWeightLicense": "NVIDIA License: NONCOMMERCIAL research/evaluation ONLY",
        "labelPrompt": [LABEL], "trainedWeightsActuallyLoaded": False,
        "independentHeldOutFromPretraining": False, "clinicalValidation": False}
    (work / "admission.json").write_text(json.dumps(record, indent=2))
    print(json.dumps({"publicOriginalCTReady": True, "case": filename,
                      "expertCancerVoxels": voxels,
                      "sourceSha256": record["sourceSha256"],
                      "officialWeightsSha256": record["officialWeightsSha256"]}))


def _admitted(work: Path) -> dict:
    m = json.loads((work / "admission.json").read_text())
    if (m.get("schema") != "opus-colon-vista3d-admission-v1"
            or m.get("dataset") != DATASET or m.get("model") != MODEL
            or m.get("labelPrompt") != [LABEL]
            or not m.get("modelRevisionSha", "").startswith(MODEL_REV)
            or not m.get("datasetRevisionSha", "").startswith(DATASET_REV)
            or m.get("officialWeightLicense") != "NVIDIA License: NONCOMMERCIAL research/evaluation ONLY"
            or m.get("independentHeldOutFromPretraining") is not False
            or sha256(work / "ct.nii.gz") != m.get("sourceSha256")
            or sha256(work / "expert.nii.gz") != m.get("expertMaskSha256")
            or sha256(work / "bundle/models/model.pt") != m.get("officialWeightsSha256")):
        raise ValueError("original_public_case_or_official_trained_weights_not_verified")
    return m


def infer(work: Path):
    """Invokes MONAI publisher's actual inference.json, not a simulated forward pass."""
    import torch

    m = _admitted(work)
    if not torch.cuda.is_available() or torch.cuda.get_device_properties(0).total_memory < 14 * 1024**3:
        raise RuntimeError("VISTA3D_research_requires_separate_CUDA_GPU_with_14_GiB_or_more")
    bundle = work / "bundle"
    out = work / "prediction"
    if out.exists():
        raise ValueError("do_not_overwrite_prior_real_inference")
    out.mkdir()
    input_dict = repr({"image": str((work / "ct.nii.gz").resolve()), "label_prompt": [LABEL]})
    env = dict(os.environ)
    env["HF_HUB_OFFLINE"] = "1"
    env["HF_HUB_DISABLE_TELEMETRY"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    start = time.monotonic()
    subprocess.run(
        [sys.executable, "-m", "monai.bundle", "run",
         "--config_file", "configs/inference.json",
         "--input_dict", input_dict,
         "--output_dir", str(out.resolve())],
        cwd=bundle, env=env, check=True, timeout=10800)
    results = list(out.rglob("*.nii.gz"))
    if len(results) != 1:
        raise ValueError("official_VISTA3D_did_not_generate_exactly_one_mask")
    provenance = {
        "schema": "opus-colon-vista3d-executed/v1",
        "sourceSha256": m["sourceSha256"],
        "officialWeightsSha256": m["officialWeightsSha256"],
        "modelRevisionSha": m["modelRevisionSha"],
        "labelPrompt": [LABEL],
        "observedModelOutputSha256": sha256(results[0]),
        "observedOutputRelativePath": results[0].relative_to(work).as_posix(),
        "realGpuInferenceCompleted": True, "seconds": round(time.monotonic() - start, 2)}
    (work / "execution.json").write_text(json.dumps(provenance, indent=2))


def count_confusion(prediction, expert):
    import numpy as np

    if prediction.shape != expert.shape:
        raise ValueError("tumor_mask_original_grid_shape_mismatch")
    if not np.isin(prediction, (0, LABEL)).all() or not np.isin(expert, (0, 1)).all():
        raise ValueError("non_binary_or_unresolved_VISTA3D_tumor_labels")
    gt = expert == 1
    pred = prediction == LABEL
    tp = int(np.count_nonzero(gt & pred))
    fp = int(np.count_nonzero(~gt & pred))
    fn = int(np.count_nonzero(gt & ~pred))
    return tp, fp, fn


def evaluate(work: Path, report: Path):
    import nibabel as nib
    import numpy as np
    from scipy import ndimage

    if report.exists() or report.is_symlink():
        raise ValueError("do_not_replace_existing_real_result")
    m = _admitted(work)
    run = json.loads((work / "execution.json").read_text())
    rel = run.get("observedOutputRelativePath")
    if (run.get("schema") != "opus-colon-vista3d-executed/v1"
            or run.get("realGpuInferenceCompleted") is not True
            or run.get("sourceSha256") != m["sourceSha256"]
            or run.get("officialWeightsSha256") != m["officialWeightsSha256"]
            or run.get("modelRevisionSha") != m["modelRevisionSha"]
            or run.get("labelPrompt") != [LABEL]
            or not isinstance(rel, str) or not rel.startswith("prediction/")):
        raise ValueError("real_trained_inference_provenance_missing_or_changed")
    prediction_path = (work / rel).resolve()
    if not prediction_path.is_relative_to((work / "prediction").resolve()):
        raise ValueError("prediction_path_traversal_not_allowed")
    _bounded(prediction_path)
    if sha256(prediction_path) != run.get("observedModelOutputSha256"):
        raise ValueError("real_pretrained_prediction_changed")
    original, n = verify_pair(work / "ct.nii.gz", work / "expert.nii.gz")
    pred_image = nib.load(str(prediction_path))
    if (pred_image.ndim != 3 or pred_image.shape != original.shape
            or not np.isfinite(pred_image.affine).all()
            or not np.allclose(pred_image.affine, original.affine, atol=0.05, rtol=0)):
        raise ValueError("pretrained_cancer_prediction_not_registered_to_original_CT")
    raw = np.asarray(pred_image.dataobj)
    if not np.isfinite(raw).all() or not np.equal(raw, np.rint(raw)).all():
        raise ValueError("unresolved_VISTA3D_prediction_floats")
    prediction = raw.astype(np.uint8)
    expert = np.asarray(nib.load(str(work / "expert.nii.gz")).dataobj)
    tp, fp, fn = count_confusion(prediction, expert)
    if tp + fn != n:
        raise ValueError("expert_reference_label_count_changed")
    # 26-neighborhood candidates, source-native XYZ voxel boxes; no fabricated DICOM SOP.
    components, count = ndimage.label(prediction == LABEL, structure=np.ones((3, 3, 3)))
    candidates = []
    for identifier, component_slice in enumerate(ndimage.find_objects(components), 1):
        if component_slice is None:
            continue
        size = int(np.count_nonzero(components[component_slice] == identifier))
        if size < 10:
            continue
        box = [[int(a.start), int(a.stop - 1)] for a in component_slice]
        candidates.append({"nativeVoxelBoxXYZ": box, "volumeVoxels": size,
                           "sourceGeometry": "NIfTI affine; not DICOM SOP resolved"})
    candidates.sort(key=lambda v: v["volumeVoxels"], reverse=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    result = {
        "schema": SCHEMA, "task": "CT colon cancer primary lesion segmentation",
        "region": ["abdomen", "pelvis"], "modality": "CT",
        "realOfficialPretrainedInference": True,
        "model": MODEL, "modelRevisionSha": m["modelRevisionSha"],
        "modelWeightsSha256": m["officialWeightsSha256"],
        "license": m["officialWeightLicense"], "dataset": DATASET,
        "datasetRevisionSha": m["datasetRevisionSha"],
        "sourceSha256": m["sourceSha256"], "expertSha256": m["expertMaskSha256"],
        "predictionSha256": run["observedModelOutputSha256"],
        "case": m["sourceName"], "nativeShape": list(original.shape),
        "classId": LABEL, "expertVoxels": n, "predictedVoxels": tp + fp,
        "TP": tp, "FP": fp, "FN": fn,
        "voxelDice": round(2 * tp / (2 * tp + fp + fn), 6) if tp + fp + fn else None,
        "voxelRecall": round(tp / (tp + fn), 6) if tp + fn else None,
        "voxelPrecision": round(tp / (tp + fp), 6) if tp + fp else None,
        "localizedNativeVoxelCandidates": candidates[:100],
        "sourceBoundVoxelGrid": True, "boundToDicomSop": False,
        "independentTrainingHoldout": False, "clinicalValidation": False,
        "patientUseAllowed": False,
        "limitations": [
            "Publisher checkpoint is NVIDIA noncommercial research/evaluation only.",
            "Single MSD training sample; overlap with model training NOT excluded.",
            "Voxel metrics are descriptive, not independent diagnostic accuracy.",
            "NIfTI voxel-space lesion boxes still require DICOM-SOP source mapping.",
            "Missing/empty prediction does not establish disease absence."
        ]}
    report.write_text(json.dumps(result, indent=2))
    print(json.dumps({key: result[key] for key in
                      ("case", "TP", "FP", "FN", "voxelDice", "realOfficialPretrainedInference")}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=("prepare", "infer", "evaluate", "all"), required=True)
    ap.add_argument("--work", type=Path, required=True)
    ap.add_argument("--report", type=Path)
    a = ap.parse_args()
    if a.mode in ("prepare", "all"):
        prepare(a.work)
    if a.mode in ("infer", "all"):
        infer(a.work)
    if a.mode in ("evaluate", "all"):
        if not a.report:
            raise ValueError("explicit_numeric_only_report_required")
        evaluate(a.work, a.report)


if __name__ == "__main__":
    main()
