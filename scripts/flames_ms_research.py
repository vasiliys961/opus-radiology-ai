#!/usr/bin/env python3
"""FLAMeS ORIGINAL nnU-Net trained MS lesion segmentation; opt-in research worker.

Distinct disease-specific MRI model from nonspecific WMH. Only verified skull-
stripped single FLAIR, a spatially matched brain mask and official installed
Dataset004_WML nnUNetTrainer_8000epochs checkpoints are accepted. Nothing uploads.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

MAX_VOXELS = 75_000_000
MAX_NIFTI_BYTES = 750 * 1024**2
OFFICIAL_ZENODO = "https://zenodo.org/records/17955359"
OFFICIAL_ARCHIVE_MD5 = "8b90b789d6ceca1886f42fa1724a08cc"
TRAINER = "nnUNetTrainer_8000epochs"
DATASET_ID = 4


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(2 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_inputs(source: Path, brain_mask: Path) -> dict:
    import nibabel as nib
    import numpy as np
    for p in (source, brain_mask):
        if p.is_symlink() or not p.is_file() or not 1024 < p.stat().st_size < MAX_NIFTI_BYTES:
            raise ValueError("source or skull stripping mask missing, linked or exceeds bound")
        if not p.name.endswith(".nii.gz"):
            raise ValueError("source and brain mask must be NIfTI .nii.gz files")
    if not source.name.endswith("_0000.nii.gz"):
        raise ValueError("model requires single channel filename *_0000.nii.gz")
    name = source.name[:-12]
    if not name or not all(ch.isalnum() or ch in "-_" for ch in name):
        raise ValueError("invalid nnU-Net case identifier")
    img, brain = nib.load(str(source)), nib.load(str(brain_mask))
    if (img.ndim != 3 or brain.ndim != 3 or img.shape != brain.shape
            or int(np.prod(img.shape)) > MAX_VOXELS or
            min(img.shape) < 24 or max(img.shape) > 1024):
        raise ValueError("source and brain mask must have same bounded 3D grid")
    if (not np.isfinite(img.affine).all() or not np.isfinite(brain.affine).all()
            or abs(float(np.linalg.det(img.affine[:3, :3]))) < 1e-8
            or not np.allclose(img.affine, brain.affine, atol=1e-4, rtol=0)):
        raise ValueError("source and skull stripping mask must share physical grid")
    units = img.header.get_xyzt_units()[0]
    if units != "mm" or brain.header.get_xyzt_units()[0] != "mm":
        raise ValueError("native mm units required for spatial lesion localization")
    foreground = nonzero = outside = 0
    for k in range(img.shape[2]):
        plane = np.asarray(img.dataobj[:, :, k], dtype=np.float32)
        mask = np.asarray(brain.dataobj[:, :, k])
        if (not np.isfinite(plane).all() or not np.isfinite(mask).all()
                or not np.isin(mask, (0, 1)).all()):
            raise ValueError("FLAIR must be finite and brain mask must be binary")
        brain_pixels = mask == 1
        foreground += int(brain_pixels.sum())
        nonzero += int(np.count_nonzero(plane[brain_pixels]))
        # FLAIR must ALREADY be skull stripped. Do not call arbitrary source
        # "preprocessed" from metadata alone.
        outside += int(np.count_nonzero(plane[~brain_pixels]))
    if foreground < 2500 or nonzero < 2500 or outside:
        raise ValueError("FLAIR outside brain is nonzero or brain extraction failed")
    return {
        "sourceSha256": sha256(source),
        "skullStripBrainMaskSha256": sha256(brain_mask),
        "sourceShape": list(img.shape),
        "sourceSpatialUnits": "mm",
        "nonzeroPixelsOutsideBrainMask": outside,
        "brainForegroundVoxelCount": foreground,
        "brainNonzeroIntensityVoxelCount": nonzero,
        "sourceAndBrainMaskAligned": True,
        "upstreamSkullStripProvenanceNotIndependentlyEstablished": True,
        "singleFLAIRImageNotSufficientToDiagnoseMS": True,
    }


def original_model_installation(results: Path) -> dict:
    model_dirs = list(results.glob("Dataset004_*"))
    if len(model_dirs) != 1 or model_dirs[0].name != "Dataset004_WML":
        raise ValueError("one exact installed publisher Dataset004_WML required")
    model = model_dirs[0]
    configs = list(model.glob(TRAINER + "__*__3d_fullres"))
    if len(configs) != 1:
        raise ValueError("missing official 3d_fullres FLAMeS 8000epoch trainer")
    data_file = model / "dataset.json"
    if not data_file.is_file() or data_file.is_symlink():
        raise ValueError("publisher nnU-Net dataset ontology absent")
    dataset = json.loads(data_file.read_text(encoding="utf-8"))
    channels = dataset.get("channel_names")
    labels = dataset.get("labels")
    if (not isinstance(channels, dict) or len(channels) != 1
            or "0" not in channels or not isinstance(labels, dict)
            or len(labels) != 2 or set(labels.values()) != {0, 1}
            or labels.get("background") != 0
            or dataset.get("file_ending") != ".nii.gz"):
        raise ValueError("original FLAMeS single-channel binary labels not confirmed")
    folds = sorted(p for p in configs[0].glob("fold_*") if p.is_dir())
    if not folds or len(folds) > 5 or any(
        p.name not in ("fold_0", "fold_1", "fold_2", "fold_3", "fold_4") for p in folds
    ):
        raise ValueError("original nnU-Net fold inventory unsupported")
    checkpoints = {p.name.removeprefix("fold_"): p / "checkpoint_final.pth" for p in folds}
    if any(not p.is_file() or p.is_symlink() or not 1024 < p.stat().st_size < MAX_NIFTI_BYTES
           for p in checkpoints.values()):
        raise ValueError("final pretrained model checkpoints absent/invalid; no surrogate weights")
    return {
        "datasetMetadataSha256": sha256(data_file),
        "modelFoldCheckpointsSha256": {i: sha256(p) for i, p in checkpoints.items()},
        "folds": sorted(checkpoints.keys()),
        "originalLabelIds": {k: v for k, v in labels.items()},
        "trainer": TRAINER,
        "originalPublisher": OFFICIAL_ZENODO,
        "modelArchivePublisherMd5ReferenceNotLocalArchiveVerification": OFFICIAL_ARCHIVE_MD5,
    }


def evaluate_original_prediction(source: Path, predicted: Path) -> dict:
    import nibabel as nib
    import numpy as np
    from scipy import ndimage
    if predicted.is_symlink() or not predicted.is_file() or predicted.stat().st_size > MAX_NIFTI_BYTES:
        raise ValueError("trained forward did not produce ordinary bounded mask")
    img, pred = nib.load(str(source)), nib.load(str(predicted))
    if (pred.ndim != 3 or pred.shape != img.shape
            or not np.isfinite(pred.affine).all()
            or not np.allclose(pred.affine, img.affine, rtol=0, atol=1e-4)
            or pred.header.get_xyzt_units()[0] != "mm"):
        raise ValueError("predicted MS lesion mask is not on native source grid")
    arr = np.asanyarray(pred.dataobj)
    if not np.isin(arr, (0, 1)).all():
        raise ValueError("original model output nonbinary; no clinical label assumptions")
    lesions, total = ndimage.label(arr == 1, structure=np.ones((3, 3, 3), dtype=np.uint8))
    objects = ndimage.find_objects(lesions)
    voxel_volume_ml = abs(float(np.linalg.det(img.affine[:3, :3]))) / 1000.0
    regions = []
    for i, slices in enumerate(objects, 1):
        if slices is None:
            continue
        local = lesions[slices] == i
        voxels = int(np.count_nonzero(local))
        low = [int(s.start) for s in slices]
        high = [int(s.stop) - 1 for s in slices]
        centroid_local = np.argwhere(local).mean(axis=0)
        centroid_ijk = [float(centroid_local[j] + low[j]) for j in range(3)]
        centroid_ras = (img.affine @ np.array([*centroid_ijk, 1.0]))[:3]
        regions.append({
            "nativeVoxelBoundsInclusive": [low, high],
            "nativeVoxelCentroid": [round(v, 3) for v in centroid_ijk],
            "rasMmCentroid": [round(float(v), 3) for v in centroid_ras],
            "voxelCount": voxels, "volumeMl": round(voxels * voxel_volume_ml, 5),
        })
    return {
        "modelOutputSha256": sha256(predicted),
        "modelOriginalNativeGridVerified": True,
        "connectedComponentConnectivity": 26,
        "modelCandidateComponentCount": len(regions),
        "modelCandidateVoxels": int(np.count_nonzero(arr)),
        "modelCandidateVolumeMl": round(int(np.count_nonzero(arr)) * voxel_volume_ml, 5),
        "regionsOriginalSourceCoordinates": regions,
        "lesionDetectionReferenceAvailable": False,
        "expertDiceNotMeasured": True,
        "clinicallyValidated": False,
        "canDiagnoseMS": False,
        "canDifferentiateMSFromSmallVesselWMH": False,
    }



def compare_expert_ms_lesions(source: Path, prediction: Path,
                              expert: Path, brain_mask: Path) -> dict:
    """Source-matched real-mask comparison after original trained forward ONLY.

    Strict 26-connected one-to-one overlap pairing; this is a single reference
    evaluation, NOT a clinical MS diagnosis or a claim of held-out validation.
    """
    import nibabel as nib
    import numpy as np
    from scipy import ndimage

    for path in (source, prediction, expert, brain_mask):
        if (path.is_symlink() or not path.is_file() or
                not 1024 < path.stat().st_size < MAX_NIFTI_BYTES):
            raise ValueError("expert comparison requires real bounded source and masks")
    orig, pred, ref, brain = (nib.load(str(p)) for p in
                             (source, prediction, expert, brain_mask))
    for candidate in (pred, ref, brain):
        if (candidate.shape != orig.shape or candidate.ndim != 3
                or candidate.header.get_xyzt_units()[0] != "mm"
                or not np.isfinite(candidate.affine).all()
                or not np.allclose(candidate.affine, orig.affine, rtol=0, atol=1e-4)):
            raise ValueError("expert/predicted/brain mask not in original FLAIR source grid")
    if orig.header.get_xyzt_units()[0] != "mm":
        raise ValueError("expert native FLAIR millimetre units missing")
    for labelmask in (pred, ref, brain):
        if labelmask.header.get_data_dtype().kind not in "biu":
            raise ValueError("expert comparison requires integer binary masks")
    p = np.asanyarray(pred.dataobj)
    e = np.asanyarray(ref.dataobj)
    b = np.asanyarray(brain.dataobj)
    if (not np.isin(p,(0,1)).all() or not np.isin(e,(0,1)).all()
            or not np.isin(b,(0,1)).all()):
        raise ValueError("MS model/expert/brain reference binary ontology not confirmed")
    p, e, b = p==1, e==1, b==1
    if not np.any(e) or np.any(e & ~b):
        raise ValueError("positive expert MS lesion mask within source brain is required")

    tp = int(np.count_nonzero(p & e))
    fp = int(np.count_nonzero(p & ~e))
    fn = int(np.count_nonzero(~p & e))
    label_structure = np.ones((3,3,3),dtype=np.uint8)
    predicted_cc, npred = ndimage.label(p,structure=label_structure)
    expert_cc, nexpert = ndimage.label(e,structure=label_structure)
    if npred>4096 or nexpert>4096:
        raise ValueError("excessive mask components require expert review")
    # Each matched lesion is counted at most once. A fused large candidate
    # cannot artificially claim detection of all small expert lesions.
    pairs = predicted_cc[p & e].astype(np.int64)*(nexpert+1) + expert_cc[p & e]
    unique, overlap_counts = np.unique(pairs,return_counts=True)
    claimed_pred, claimed_expert = set(),set()
    for k in np.argsort(-overlap_counts, kind="stable"):
        vp, ve = divmod(int(unique[k]), nexpert+1)
        if vp and ve and vp not in claimed_pred and ve not in claimed_expert:
            claimed_pred.add(vp)
            claimed_expert.add(ve)
    matched = len(claimed_expert)
    return {
        "referenceType": "original source-grid binary expert MS lesion masks",
        "expertMaskSha256": sha256(expert),
        "actualPredictionMaskSha256": sha256(prediction),
        "originalSourceFlairSha256": sha256(source),
        "brainMaskSha256": sha256(brain_mask),
        "originalSourceGridAndMillimetresVerified": True,
        "expertMSLesionOntologyOperatorReviewed": True,
        "voxelTP": tp,
        "voxelFP": fp,
        "voxelFN": fn,
        "voxelDice": round(2*tp/(2*tp+fp+fn),6),
        "expert26ConnectedLesionCount": int(nexpert),
        "predicted26ConnectedCandidateCount": int(npred),
        "oneToOneOverlapMatchedLesions": int(matched),
        "missedExpertLesions": int(nexpert-matched),
        "unmatchedPredictedCandidates": int(npred-matched),
        "singleCaseExpertLesionRecall": round(matched/nexpert,6),
        "matchingRule": "26-connected components, one-to-one greedy descending intersecting voxels, any nonzero overlap",
        "clinicalDiagnosisValidated": False,
        "trainingPatientOverlapExcluded": False,
        "independentClinicalValidation": False,
        "singleFLAIRCannotDistinguishMSFromNonspecificWMH": True,
    }


def run(source: Path, brain_mask: Path, results: Path, output: Path, *, execute: bool, device: str,
        expert: Path | None = None, expert_lesion_labels_confirmed: bool = False,
        expert_rights_reviewed: bool = False):
    source, brain_mask, results = (p.expanduser().resolve(strict=True) for p in
                                   (source, brain_mask, results))
    output = output.expanduser().resolve()
    if not results.is_dir() or output == results or output.is_relative_to(results):
        raise ValueError("results/output separation required")
    if output == source.parent or output.is_relative_to(source.parent):
        raise ValueError("source/output separation required")
    if output == brain_mask.parent or output.is_relative_to(brain_mask.parent):
        raise ValueError("skull-strip-mask/output separation required")
    if expert is not None and (not execute or not expert_lesion_labels_confirmed or not expert_rights_reviewed):
        raise ValueError("expert mask requires real model inference, verified lesion ontology and rights")
    if expert is None and (expert_lesion_labels_confirmed or expert_rights_reviewed):
        raise ValueError("expert flags cannot substitute missing real expert mask")
    src = check_inputs(source, brain_mask)
    model = original_model_installation(results)
    report = {
        "schema": "opus-flames-original-ms-flair/v1",
        "modality": "MRI FLAIR skull-stripped only",
        "pathologyModel": "FLAMeS original trained MS lesion nnU-Net",
        "sourceEvidence": src, "modelEvidence": model,
        "clinicalValidation": False,
        "diagnosisFromFlairAlone": False,
        "independentReferenceCompared": False,
        "trueOriginalForward": False,
    }
    if not execute:
        return report
    if sys.platform != "linux":
        raise ValueError("heavy MS model inference is confined to isolated Linux CPU/GPU worker")
    if shutil.which("nnUNetv2_predict") is None:
        raise ValueError("original nnUNetv2_predict not installed on isolated worker")
    if any(source.parent.glob("*_0000.nii.gz")) and len(list(source.parent.glob("*_0000.nii.gz"))) != 1:
        raise ValueError("only one case allowed in model input directory")
    if output.exists():
        raise ValueError("output directory must not exist; prevent stale mask")
    output.mkdir(mode=0o700, parents=True)
    env = __import__("os").environ.copy()
    env["nnUNet_results"] = str(results)
    env["nnUNet_raw"] = str(output / "raw")
    env["nnUNet_preprocessed"] = str(output / "preprocessed")
    Path(env["nnUNet_raw"]).mkdir(mode=0o700)
    Path(env["nnUNet_preprocessed"]).mkdir(mode=0o700)
    command = ["nnUNetv2_predict", "-i", str(source.parent), "-o", str(output),
               "-d", str(DATASET_ID), "-c", "3d_fullres", "-tr", TRAINER,
               "-f", *model["folds"], "-device", device]
    subprocess.run(command, check=True, env=env, timeout=7200)
    if sha256(source) != src["sourceSha256"] or sha256(brain_mask) != src["skullStripBrainMaskSha256"]:
        raise ValueError("source or brain mask changed during model inference")
    pred = output / (source.name[:-12] + ".nii.gz")
    report["predictionEvidence"] = evaluate_original_prediction(source, pred)
    if expert is not None:
        report["expertReferenceEvidence"] = compare_expert_ms_lesions(
            source, pred, expert.expanduser().resolve(strict=True), brain_mask)
        report["independentReferenceCompared"] = True
    report["trueOriginalForward"] = True
    (output / "flames-ms-numeric-evidence.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path, required=True)
    ap.add_argument("--brain-mask", type=Path, required=True)
    ap.add_argument("--nnunet-results", type=Path, required=True)
    ap.add_argument("--output", type=Path, required=True)
    ap.add_argument("--device", choices=("cpu", "cuda"), default="cpu")
    ap.add_argument("--execute", action="store_true")
    ap.add_argument("--expert-ms-mask", type=Path, default=None)
    ap.add_argument("--expert-ms-lesion-labels-confirmed", action="store_true")
    ap.add_argument("--expert-source-rights-reviewed", action="store_true")
    a = ap.parse_args()
    try:
        print(json.dumps(run(a.source, a.brain_mask, a.nnunet_results,
                             a.output, execute=a.execute, device=a.device,
                             expert=a.expert_ms_mask,
                             expert_lesion_labels_confirmed=a.expert_ms_lesion_labels_confirmed,
                             expert_rights_reviewed=a.expert_source_rights_reviewed), indent=2))
    except (OSError, ValueError, ImportError, RuntimeError, subprocess.SubprocessError) as exc:
        print("FLAMeS original trained research pipeline rejected: " + str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
