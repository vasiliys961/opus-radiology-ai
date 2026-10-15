#!/usr/bin/env python3
"""Genuine ianpan ICH pretrained research inference on an explicitly approved PUBLIC HU NCCT.

The six outputs are experimental probabilities/localization heatmaps, NOT
clinical diagnoses, HU recovery, patient triage, segmentation volumes or
source-grid masks. No test/synthetic checkpoint is ever reported as real.
No patient upload, credentials, weights or medical pixels enter reports.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import time

MODEL_REPO = "ianpan/ct-head-hemorrhage-detection"
# Immutable model integrity is enforced by these original published SHA-256
# hashes regardless of how an abbreviated HF ref resolves.
MODEL_REV = "e6d89c2"
MODEL_FILES = {
    "inference.py": ("9792e50ad1d863e80a549d391ee53c5031d490abb75acba42d471b02a83fbafb", 24554),
    "classifier/model.safetensors": ("525b5fc1731dab82fcdb1eb878570f4cf4b0fed483e307bc65e312a4d91c1489", 122429448),
    "sequence/model.safetensors": ("9421066cb5c6882087730b367b578f0fb8b6935391c2611bbc4bc2241c8ee487", 11098536),
    "segmentation/fold0.safetensors": ("d299e204c640bdc124829b5cc2e6d5e08973b8c17698a5bffdd565baa46ec786", 5498088),
    "segmentation/fold1.safetensors": ("1dbad6ad4dfd21e963e01a71f4486558287fe32e3acdcf47ad601ad8a3132c3e", 5498088),
    "segmentation/fold2.safetensors": ("e814b8e398b7c879c22663187d7c58ff88ee0fcaf11ea4e76859c35488b4d052", 5498088),
    "segmentation/fold3.safetensors": ("971bfe1163797c3587c045ef013475e6cd5973aa7116f8b01f8305725777910d", 5498088),
    "segmentation/fold4.safetensors": ("f1913ce8d7f9cacbb948615a7690cfad568fe0f713c1f11de9ac3199ff060e8f", 5498088),
}
CLASS_NAMES = ("epidural", "intraparenchymal", "intraventricular",
               "subarachnoid", "subdural", "any")
MAX_SOURCE_BYTES = 128 * 1024**2
MAX_SOURCE_VOXELS = 512 * 512 * 64

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024**2), b""):
            h.update(part)
    return h.hexdigest()

def validate_public_manifest(source: Path, manifest_path: Path) -> dict:
    if source.is_symlink() or source.suffix not in (".nii", ".gz") or (
        source.suffix == ".gz" and not source.name.endswith(".nii.gz")
    ) or not source.is_file() or not 352 <= source.stat().st_size <= MAX_SOURCE_BYTES:
        raise ValueError("unsupported_bounded_source_nifti")
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 4096:
        raise ValueError("invalid_public_manifest")
    document = json.loads(manifest_path.read_text(encoding="utf-8"))
    # Fixed, separately published public original CT. It is only HU-LIKE:
    # DICOM RescaleSlope/Intercept of individual originals were NOT independently
    # rechecked. This is exploratory pretrained inference, NEVER validated HU.
    publisher_source = (
        isinstance(document, dict)
        and document.get("sourceUnits")
          == "PUBLISHED_DICOM_DERIVED_CT_HU_LIKE_NOT_DICOM_RESCALE_INDEPENDENTLY_VERIFIED"
        and isinstance(document.get("publisherProvenance"),dict)
        and document["publisherProvenance"].get("datasetDoi")=="10.7281/T1/CZDPSX"
        and document["publisherProvenance"].get("publishedArchiveMd5")=="a1e57f5cb684fc238d32a019bec456ad"
        and document["publisherProvenance"].get("dicomRescaleIndependentlyVerified") is False
        and document["publisherProvenance"].get("intensitiesAreOnlyPlausiblyHU") is True
        and document["publisherProvenance"].get("originalStudyAllSourceSlicesRetained") is True
        and document["publisherProvenance"].get("publicSourceAuditIsNotClinicalValidation") is True
    )
    direct_dicom_source = isinstance(document,dict) and document.get("sourceUnits") == "HU_FROM_VERIFIED_DICOM_RESCALE"
    if not isinstance(document, dict) or any([
        document.get("schema") != "opus-public-head-ct-hu-evidence/v1",
        document.get("modality") != "CT",
        document.get("anatomy") != "HEAD",
        document.get("contrast") != "NONCONTRAST",
        document.get("publicDataRightsReviewed") is not True,
        document.get("deidentifiedPublicDataset") is not True,
        not (direct_dicom_source or publisher_source),
        document.get("sourceFullStudy") is not True,
        document.get("consent") != "PUBLIC-HEAD-NCCT-RESEARCH-OK",
    ]):
        raise ValueError("public_hu_ncct_provenance_not_approved")
    expected = document.get("sourceNiftiSha256")
    if not isinstance(expected, str) or len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("missing_public_source_sha256")
    if sha256(source) != expected:
        raise ValueError("source_sha256_changed")
    if publisher_source and document.get("publisherProvenance",{}).get("dimensionsXYZ") != list(__import__("nibabel").load(str(source)).shape):
        raise ValueError("published_source_dimensions_mismatch")
    # An operator provenance assertion is not independent confirmation of HU.
    # In particular the previously used Zenodo 16-slice slab is NOT admitted
    # without proof that its stored values are original calibrated CT HU.
    return document

def verify_model_files(root: Path) -> None:
    if root.is_symlink() or not root.is_dir():
        raise ValueError("invalid_model_directory")
    for name, (digest, size) in MODEL_FILES.items():
        p = root / name
        if p.is_symlink() or not p.is_file() or p.stat().st_size != size or sha256(p) != digest:
            raise ValueError("missing_or_tampered_pretrained_asset:" + name)

def obtain_model(root: Path, download: bool) -> None:
    if download:
        from huggingface_hub import snapshot_download
        snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REV, local_dir=str(root),
                          allow_patterns=list(MODEL_FILES))
    verify_model_files(root)

def check_nii_geometry(source: Path):
    import nibabel as nib
    import numpy as np
    image = nib.load(str(source))
    dims = image.shape
    if len(dims) != 3 or any(n < 8 or n > 512 for n in dims) or (
        math.prod(dims) > MAX_SOURCE_VOXELS
    ):
        raise ValueError("source_volume_exceeds_research_limit")
    affine = image.affine
    if not np.isfinite(affine).all():
        raise ValueError("source_affine_invalid")
    basis = affine[:3,:3]
    lengths = np.linalg.norm(basis, axis=0)
    if np.any(lengths < 0.1) or np.any(lengths > 12):
        raise ValueError("source_spacing_invalid")
    direction = basis / lengths
    # Vendor NIfTI loader only permutes nearest axes; oblique scans would
    # lose physical correspondence without a validated resampling method.
    if not np.allclose(direction.T @ direction, np.eye(3), atol=1e-4) or (
        np.any(np.max(np.abs(direction), axis=0) < 0.999)
    ):
        raise ValueError("oblique_or_invalid_source_orientation")
    return image

def numeric_predictions(output, slices: int):
    """Extract original classifier proposals and 512x512 heatmap ROIs.

    Spatial output is in PREPROCESSED MODEL INPUT, not source NIfTI coordinates.
    No volume in ml, Dice, TP/FP/FN or negative diagnosis can be inferred here.
    """
    import numpy as np
    slice_scores = np.asarray(output["slice_classification"])
    series_scores = np.asarray(output["series_classification"])
    masks = np.asarray(output["segmentation"])
    if (slice_scores.shape != (slices,6) or series_scores.shape != (6,) or
        masks.shape != (slices,6,512,512) or
        not all(np.isfinite(a).all() for a in (slice_scores,series_scores,masks)) or
        any(np.any(a < 0) or np.any(a > 1) for a in (slice_scores,series_scores,masks))):
        raise ValueError("invalid_genuine_model_prediction_shapes")
    candidates = []
    for k in range(slices):
        for c, label in enumerate(CLASS_NAMES):
            score = float(slice_scores[k,c])
            if score < 0.5:
                continue
            # A research heatmap region, never a measured hematoma or native mask.
            yy,xx = np.nonzero(masks[k,c] >= 0.5)
            candidates.append({
                "sliceIndexModelOrdered": k, "class": label, "rawUncalibratedScore": round(score,6),
                "heatmapPositivePixelsAtPoint5": int(len(xx)),
                "modelInputBoundingBoxXY": ([int(xx.min()),int(yy.min()),int(xx.max()),int(yy.max())]
                                            if len(xx) else None),
                "localizationFrame": "preprocessed_512_model_input_not_source_voxel",
                "clinicallyConfirmed": False,
            })
    return {
        "seriesRawUncalibratedScores": {label:round(float(v),6)
                                      for label,v in zip(CLASS_NAMES,series_scores)},
        "candidates": candidates,
        "thresholdForResearchListing": 0.5,
    }

def run(args):
    source = args.source
    manifest = validate_public_manifest(source,args.manifest)
    if args.output.exists() or args.output.suffix != ".json":
        raise ValueError("output_must_be_new_json_file")
    if args.device not in ("cpu","cuda"):
        raise ValueError("unknown_device")
    # Admit resources and source geometry BEFORE any external weight download.
    # This is for a provisioned research worker, NOT the user's M1/8GiB Mac.
    import psutil
    available = psutil.virtual_memory().available
    if available < 10 * 1024**3:
        raise MemoryError("research_worker_requires_10_gib_available_ram")
    image = check_nii_geometry(source)
    original_dims = list(image.shape)
    import torch
    if args.device == "cuda" and not torch.cuda.is_available():
        raise ValueError("approved_cuda_device_not_available")
    obtain_model(args.model_dir,args.download_pretrained)
    import numpy as np
    # Never execute arbitrary upstream Python until its exact SHA-256 matches.
    spec = importlib.util.spec_from_file_location("opus_ianpan_pinned_inference",args.model_dir/"inference.py")
    if spec is None or spec.loader is None:
        raise ValueError("cannot_load_pinned_inference")
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    volume = upstream.read_nifti_volume(source)
    if volume.shape[0] > 64 or volume.ndim != 3 or not np.isfinite(volume).all():
        raise ValueError("unsupported_public_head_series_volume")
    # Finite range is a sanity check; manifest provenance is still required.
    if float(volume.min()) < -4096 or float(volume.max()) > 6000 or float(volume.max()-volume.min()) < 100:
        raise ValueError("non_hu_like_ct_values_or_uniform_source")
    started = time.monotonic()
    model = upstream.HemorrhageSliceModel(
        repo_id=MODEL_REPO,revision=MODEL_REV,local_dir=args.model_dir,device=args.device)
    output = model.predict_hu_volume(volume,batch_size=1,return_segmentation=True)
    evidence = numeric_predictions(output,len(volume))
    from ianpan_source_roi import map_ich_model_regions_to_nifti
    evidence["candidates"] = map_ich_model_regions_to_nifti(image,evidence["candidates"])
    result = {
        "schema": "opus-ianpan-genuine-public-ich-research/v1",
        "status": "genuine_pretrained_inference_requires_independent_validation",
        "externalExpertHemorrhageLocalizationComparisonPerformed":False,
        "model": {"id": MODEL_REPO,"revision":MODEL_REV,
                  "sha256ByArtifact":{key:val[0] for key,val in MODEL_FILES.items()},
                  "checkpointSha256Verified":True},
        "source": {"niftiSha256":manifest["sourceNiftiSha256"],
                   "sourceDimensionsXYZ":original_dims,
                   "modelOrderedSliceCount":len(volume),
                   "publicRightsOperatorAttested":True,
                   "huProvenanceOperatorAttestedNotIndependentlyConfirmed":True,
                   "huScaleRecheckedFromOriginalDicom":bool(manifest.get("sourceUnits") == "HU_FROM_VERIFIED_DICOM_RESCALE"),
                   "publisherCtNiftiHuOnlyPlausible":bool(manifest.get("sourceUnits") != "HU_FROM_VERIFIED_DICOM_RESCALE"),
                   "modelPixelsNotRegisteredToSource":True,
                   "researchRoiVoxelGeometryProjectionAvailable":True,
                   "researchRoiClinicalValidation":False},
        "runtime": {"executionDevice":args.device,
                    "elapsedSeconds":round(time.monotonic()-started,3)},
        **evidence,
        "diagnosticInterpretation": "research_candidates_only",
        "modelInputHeatmapsAreSourceAligned": False,
        "sensitivity":None,"specificity":None,"dice":None,
        "negativeDiagnosticConclusionAllowed":False,"readyForClinicalUse":False,
    }
    # No pixel/heatmap arrays or site/patient paths enter the artifact/logs.
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False))
    print(json.dumps({"result":"research_json_created",
                      "candidateCount":len(evidence["candidates"]),
                      "trainedModelExecuted":True,"clinicalValidation":False}))
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",type=Path,required=True,help="Authorized public source .nii or .nii.gz, HU")
    p.add_argument("--manifest",type=Path,required=True,help="Independent public rights and HU provenance manifest")
    p.add_argument("--model-dir",type=Path,required=True,help="Separate pinned Safetensors assets")
    p.add_argument("--output",type=Path,required=True,help="Research JSON result; must not exist")
    p.add_argument("--device",choices=["cpu","cuda"],default="cpu")
    p.add_argument("--download-pretrained",action="store_true",help="Opt-in official assets download; SHA pinned")
    a=p.parse_args()
    run(a)
if __name__=="__main__":
    main()
