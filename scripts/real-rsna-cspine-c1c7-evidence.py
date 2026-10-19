#!/usr/bin/env python3
"""C1-C7 spatial evidence for externally produced genuine RSNA 2022 model scores.

Postprocessor only. No pretrained forward pass, DICOM transfer or fracture-line
segmentation. Research-only, original public CT with verified C1-C7 anatomy.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re

SCHEMA = "opus-rsna2022-cspine-source-level-review/v1"
INPUT_SCHEMA = "opus-rsna2022-original-output/v1"
VENDOR = "https://github.com/zxjasonhu/cspine-2022-challenge-inference-collection"
MODEL_WEIGHTS = "https://www.kaggle.com/models/zixuanh/cspine-3rd-place-solution-model-weights"
RESEARCH_DATA = "https://www.kaggle.com/competitions/rsna-2022-cervical-spine-fracture-detection"
MAX_FILE = 750 * 1024**2
MAX_VOXELS = 512 * 512 * 550
# Official TotalSegmentator 2.18.0 "total" class indices, NOT RSNA segmentation's 1..7.
TOTALSEG_LABEL = {f"C{n}": 51-n for n in range(1, 8)}
SHA = re.compile(r"^[0-9a-f]{64}$")
LEVELS = tuple(f"C{i}" for i in range(1, 8))


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def bounded_file(path: Path, max_size: int) -> None:
    if path.is_symlink() or not path.is_file() or not 128 <= path.stat().st_size <= max_size:
        raise ValueError("untrusted_missing_or_oversized_local_research_asset")


def load_native(ct_path: Path, mask_path: Path):
    import nibabel as nib
    import numpy as np
    for path in (ct_path, mask_path):
        bounded_file(path, MAX_FILE)
        if not (path.name.endswith(".nii.gz") or path.suffix == ".nii"):
            raise ValueError("source_CT_and_model_anatomy_require_NIfTI")
    ct = nib.load(str(ct_path))
    mask = nib.load(str(mask_path))
    if (ct.ndim != 3 or mask.ndim != 3 or ct.shape != mask.shape or
        min(ct.shape) < 32 or math.prod(ct.shape) > MAX_VOXELS or
        ct.header.get_xyzt_units()[0] != "mm" or
        mask.header.get_xyzt_units()[0] != "mm" or
        not np.allclose(ct.affine, mask.affine, rtol=0, atol=1e-3)):
        raise ValueError("CT_and_pretrained_anatomy_mask_not_same_native_grid")
    affine = np.asarray(ct.affine, dtype=float)
    spacing = np.linalg.norm(affine[:3,:3], axis=0)
    if (not np.isfinite(affine).all() or abs(float(np.linalg.det(affine[:3,:3]))) < .01 or
        np.any(spacing < .2) or np.any(spacing > 5)):
        raise ValueError("invalid_source_C1_C7_physical_coordinates")
    if mask.header.get_data_dtype().kind not in "iu":
        raise ValueError("TotalSegmentator_total_labelmap_must_be_integer")
    labels = np.asanyarray(mask.dataobj)
    if labels.dtype.kind not in "iu" or not np.isfinite(labels).all():
        raise ValueError("invalid_CT_anatomy_label_encoding")
    return labels, affine


def c1_c7_anatomy(labels, affine):
    import numpy as np
    from scipy import ndimage
    x = np.asarray(labels)
    expected = set(TOTALSEG_LABEL.values())
    if not expected.issubset(set(int(k) for k in np.unique(x))):
        raise ValueError("incomplete_C1_C7_anatomy_no_negative_inference")
    voxel_mm3 = abs(float(np.linalg.det(affine[:3, :3])))
    objects = ndimage.find_objects(x, max_label=50)
    regions = []
    for level in LEVELS:
        label = TOTALSEG_LABEL[level]
        block = objects[label - 1] if len(objects) >= label else None
        if block is None:
            raise ValueError("missing_C1_C7_anatomy")
        crop = x[block] == label
        count = int(np.count_nonzero(crop))
        if count * voxel_mm3 < 500:
            raise ValueError("too_little_C1_C7_vertebral_segmentation")
        centroid = np.asarray(ndimage.center_of_mass(crop), dtype=float) + np.array([s.start for s in block])
        world = np.asarray(affine) @ np.r_[centroid, 1.]
        regions.append({
            "vertebra": level, "totalsegOriginalLabel": label,
            "sourceVoxelBox": [[int(s.start), int(s.stop-1)] for s in block],
            "anatomicalCentroidSourceVoxel": [round(float(v), 3) for v in centroid],
            "anatomicalCentroidRASmm": [round(float(v), 3) for v in world[:3]],
            "segmentedBoneVolumeMl": round(count * voxel_mm3 / 1000, 3),
            "fractureLineLocalized": False,
        })
    return regions


def verified_checkpoint_assets(root: Path, manifest: Path):
    if root.is_symlink() or not root.is_dir():
        raise ValueError("original_pretrained_weights_directory_required")
    bounded_file(manifest, 64 * 1024)
    meta = json.loads(manifest.read_text(encoding="utf-8"))
    files = meta.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 60:
        raise ValueError("missing_original_pretrained_weight_manifest")
    checked, seen = [], set()
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            raise ValueError("malformed_checkpoint_metadata")
        name, wanted = item["path"], item["sha256"]
        if (not isinstance(name, str) or not name or len(name) > 240 or
            Path(name).is_absolute() or ".." in Path(name).parts or
            name in seen or not isinstance(wanted, str) or not SHA.fullmatch(wanted)):
            raise ValueError("unsafe_checkpoint_path_or_SHA")
        seen.add(name)
        path = root/name
        if (path.is_symlink() or not path.is_file() or
            not path.resolve().is_relative_to(root.resolve()) or
            not 1024 <= path.stat().st_size <= 3 * 1024**3):
            raise ValueError("unavailable_untrusted_checkpoint")
        actual = digest(path)
        if actual != wanted:
            raise ValueError("pretrained_checkpoint_SHA_mismatch")
        checked.append({"relativeAsset": name, "bytes": path.stat().st_size, "sha256": actual})
    return {"manifestSHA256": digest(manifest), "assets": checked,
            "publisherDigestsIndependentlyVerified": False}


def original_scores(path: Path, ct_digest: str, weights):
    bounded_file(path, 8192)
    raw = json.loads(path.read_text(encoding="utf-8"))
    if (not isinstance(raw, dict) or
        set(raw) != {"schema", "sourceCTSHA256", "weightsManifestSHA256", "model", "scores"} or
        raw["schema"] != INPUT_SCHEMA or raw["model"] != "rsna2022-darragh-3rd" or
        raw["sourceCTSHA256"] != ct_digest or
        raw["weightsManifestSHA256"] != weights["manifestSHA256"]):
        raise ValueError("external_model_output_not_bound_to_source_and_weights_manifest")
    s = raw["scores"]
    if not isinstance(s, dict) or set(s) != {"patient_overall", *LEVELS}:
        raise ValueError("seven_level_and_patient_model_scores_required")
    if any(isinstance(v, bool) or not isinstance(v, (int,float)) or
           not math.isfinite(v) or not 0 <= v <= 1 for v in s.values()):
        raise ValueError("invalid_original_model_score")
    return {key: round(float(s[key]), 6) for key in ("patient_overall", *LEVELS)}


def clinical_evidence(anatomy, scores, weights, ct_sha, mask_sha, output_sha):
    if len(anatomy) != 7 or not all(SHA.fullmatch(s) for s in (ct_sha, mask_sha, output_sha)):
        raise ValueError("incomplete_source_bound_evidence")
    return {
        "schema": SCHEMA, "modality": "CT", "task": "cervical_C1_C7_fracture_model_review",
        "originalModel": "RSNA2022 Darragh third-place trained pathology classifier",
        "publisherProject": VENDOR, "publishedWeightsURL": MODEL_WEIGHTS,
        "originalSourcePublicURL": RESEARCH_DATA,
        "sourceUse": "RSNA competition data for authorized noncommercial research",
        "sourceCTSHA256": ct_sha, "anatomyMaskSHA256": mask_sha,
        "externalPredictionSHA256": output_sha,
        "checkpointProof": weights,
        "scoresAreUncalibratedNotClinicalProbabilities": True,
        "rawModelStudyScore": scores["patient_overall"],
        "vertebralModelScoresAndAnatomy": [
            {"vertebra": a["vertebra"], "rawFractureModelScore": scores[a["vertebra"]],
             "anatomicalLocalization": a}
            for a in anatomy
        ],
        "modelForwardExecutedByThisAdapter": False,
        "externalPredictionAuthenticityIndependentlyVerified": False,
        "pretrainedModelScoreIsNotFractureLineLocalization": True,
        "expertFractureMaskAvailable": False,
        "fractureDiagnosis": None,
        "negativeScreenEstablished": False,
        "clinicalAccuracyIndependentlyReproduced": False,
        "patientUseAllowed": False, "researchOnly": True,
        "limitations": [
            "Original external predicted scores must be produced using authorized vendor checkpoint and code.",
            "Source+checkpoint manifest equality is not cryptographic attestation that the model generated the scores.",
            "C1-C7 boxes localize anatomical vertebrae only; they do not identify a cortical break.",
            "Only full source-registered C1-C7 TotalSegmentator v2.18.0 total labelmaps (50 to 44).",
            "No absent-fracture conclusions from low or zero scores or incomplete CT.",
            "RSNA data only authorized for noncommercial research subject to original terms.",
            "Published external AUCs are model-family reports, not this adapter's accuracy.",
            "No patient input, cloud model or additional DICOM identifiers in emitted report."
        ]
    }


def run(ct: Path, mask: Path, prediction: Path, root: Path, manifest: Path,
        output: Path):
    if output.exists() or output.is_symlink() or output.suffix != ".json" or not output.parent.is_dir():
        raise ValueError("new_numeric_JSON_output_required")
    labels, affine = load_native(ct, mask)
    anatomy = c1_c7_anatomy(labels, affine)
    provenance = verified_checkpoint_assets(root, manifest)
    ct_sha = digest(ct)
    s = original_scores(prediction, ct_sha, provenance)
    report = clinical_evidence(anatomy, s, provenance, ct_sha, digest(mask), digest(prediction))
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--public-ct", type=Path, required=True)
    p.add_argument("--totalseg-total-mask", type=Path, required=True)
    p.add_argument("--model-predictions", type=Path, required=True)
    p.add_argument("--model-weights-dir", type=Path, required=True)
    p.add_argument("--model-weights-manifest", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--authorized-deidentified-RSNA-research-only", action="store_true")
    args = p.parse_args()
    if not args.authorized_deidentified_RSNA_research_only:
        p.error("Only licensed deidentified RSNA research images; no patient or cloud processing")
    doc = run(args.public_ct, args.totalseg_total_mask, args.model_predictions,
              args.model_weights_dir, args.model_weights_manifest, args.output)
    print(json.dumps({"schema": SCHEMA, "levels": len(doc["vertebralModelScoresAndAnatomy"]),
                      "modelExecutedByThisPostprocessor": False}))


if __name__ == "__main__":
    main()
