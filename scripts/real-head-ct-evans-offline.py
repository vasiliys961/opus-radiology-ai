#!/usr/bin/env python3
"""Original TotalSegmentator 2.18.0 Evans-index execution, offline and research-only.

Invokes genuine vendor trained-model algorithm ONLY when called with a pinned
local OCI image + preinstalled checkpoint manifest on a separate Linux worker.
No patient/cloud route, no checkpoint download, no use of the user Mac M1.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import tempfile

SCHEMA = "opus-head-ct-evans-vendor-evidence/v1"
MODEL = "TotalSegmentator 2.18.0 original brain/skull + ventricle_parts + atlas registration"
VENDOR = "https://github.com/wasserth/TotalSegmentator/tree/v2.18.0"
IMAGE_PATTERN = re.compile(r"^[A-Za-z0-9_./-]+@sha256:[0-9a-f]{64}$")
SHA_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ALLOWED_LICENSES = {"CC0", "CC BY 3.0", "CC BY 4.0"}
MAX_CT_BYTES = 750 * 1024**2
MAX_VOXELS = 512 * 512 * 500


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for buf in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(buf)
    return h.hexdigest()


def inspect_ct(path: Path) -> dict:
    import numpy as np
    import nibabel as nib
    if path.is_symlink() or not path.is_file() or not (1024 <= path.stat().st_size <= MAX_CT_BYTES):
        raise ValueError("missing_or_unbounded_public_head_CT")
    if path.suffix not in {".nii", ".gz"} or (path.suffix == ".gz" and not path.name.endswith(".nii.gz")):
        raise ValueError("only_CT_NIfTI_supported")
    image = nib.load(str(path))
    if (image.ndim != 3 or min(image.shape) < 32 or math.prod(image.shape) > MAX_VOXELS or
        image.header.get_xyzt_units()[0] != "mm"):
        raise ValueError("original_head_CT_geometry_invalid")
    affine = image.affine
    if not np.isfinite(affine).all() or abs(float(np.linalg.det(affine[:3, :3]))) < .01:
        raise ValueError("head_CT_physical_affine_invalid")
    spacing = np.linalg.norm(affine[:3, :3], axis=0)
    if np.any(spacing < .2) or np.any(spacing > 5):
        raise ValueError("not_supported_head_CT_slice_resolution")
    return {"shape": [int(v) for v in image.shape],
            "voxelSpacingMm": [round(float(v), 4) for v in spacing]}


def preflight_weights(root: Path, manifest_path: Path) -> dict:
    """Check actual installed bytes, not their publisher authenticity."""
    if root.is_symlink() or not root.is_dir() or manifest_path.is_symlink():
        raise ValueError("read_only_original_model_directory_required")
    if manifest_path.stat().st_size > 32 * 1024 or not manifest_path.is_file():
        raise ValueError("model_manifest_unbounded_or_missing")
    manifest = json.loads(manifest_path.read_text("utf-8"))
    files = manifest.get("files")
    if not isinstance(files, list) or not 2 <= len(files) <= 100:
        raise ValueError("both_original_trained_brain_and_ventricle_checkpoints_required")
    seen = set()
    families = set()
    summaries = []
    for item in files:
        if not isinstance(item, dict) or set(item) != {"path", "sha256", "family"}:
            raise ValueError("invalid_model_checkpoint_manifest")
        name, expected, family = item["path"], item["sha256"], item["family"]
        if family not in {"brain_skull", "ventricle_parts"}:
            raise ValueError("invalid_model_family_manifest")
        if (not isinstance(name, str) or not name or len(name) > 240 or name in seen or
            Path(name).is_absolute() or ".." in Path(name).parts or
            not isinstance(expected, str) or not SHA_PATTERN.fullmatch(expected)):
            raise ValueError("unsafe_or_duplicate_checkpoint_manifest_entry")
        seen.add(name)
        families.add(family)
        checkpoint = root / name
        if (checkpoint.is_symlink() or not checkpoint.is_file() or
            not 1024 <= checkpoint.stat().st_size <= 3 * 1024**3 or
            checkpoint.resolve().is_relative_to(root.resolve()) is False):
            raise ValueError("missing_or_untrusted_original_pretrained_checkpoint")
        found = file_hash(checkpoint)
        if found != expected:
            raise ValueError("original_pretrained_checkpoint_SHA256_mismatch")
        summaries.append({"relativeModelAsset": name, "family": family, "sha256": found,
                          "bytes": checkpoint.stat().st_size})
    if families != {"brain_skull", "ventricle_parts"}:
        raise ValueError("both_original_brain_and_ventricle_model_families_required")
    return {"manifestSHA256": file_hash(manifest_path), "verifiedInstalledAssets": summaries,
            "publisherHashesIndependentlyVerified": False}


def interpret_vendor_report(raw: dict, provenance: dict, geometry: dict,
                            ct_sha: str, image: str, source_license: str, source_url: str):
    if (not isinstance(raw, dict) or set(raw) != {
        "evans_index", "brain_volume_ml", "ventricle_volume_ml", "ventricle_brain_ratio"
    }):
        raise ValueError("original_vendor_Evans_schema_mismatch")
    names = ("evans_index", "brain_volume_ml", "ventricle_volume_ml", "ventricle_brain_ratio")
    numbers = [raw.get(name) for name in names]
    if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in numbers):
        raise ValueError("missing_or_nonfinite_original_vendor_Evans_measurements")
    index, brain_ml, ventricles_ml, volume_ratio = map(float, numbers)
    if not (.02 < index < .99 and 100 < brain_ml < 2800 and 1 < ventricles_ml < 1200 and
            0 < volume_ratio < 0.8 and abs(ventricles_ml / brain_ml - volume_ratio) < .01):
        raise ValueError("inconsistent_or_out_of_range_vendor_measurements")
    if source_license not in ALLOWED_LICENSES or not source_url.startswith("https://") or len(source_url) > 1024:
        raise ValueError("public_source_license_and_url_required")
    if not SHA_PATTERN.fullmatch(ct_sha) or not IMAGE_PATTERN.fullmatch(image):
        raise ValueError("unverified_original_source_or_OCI_image_digest")
    return {
        "schema": SCHEMA, "modality": "CT",
        "clinicalTask": "ventriculomegaly_Evans_index_review_candidate",
        "originalVendorModel": MODEL, "originalPublisherURL": VENDOR,
        "pinnedExecutorImage": image, "installedWeightManifest": provenance,
        "sourceCTSHA256": ct_sha, "originalSourceShapeAndSpacing": geometry,
        "originalSourceLicenseAsDeclared": source_license, "sourcePublicURL": source_url,
        "realVendorAlgorithmCompleted": True,
        "evansIndex": round(index, 4), "brainAndCranialCavityVolumeMl": brain_ml,
        "ventricleVolumeMl": ventricles_ml, "ventricleToBrainVolumeRatio": volume_ratio,
        "evansIndexAtLeast0_30ReviewCandidate": index >= .30,
        "originalSegmentationAndAtlasUsed": True,
        "modelOriginalPublisherCheckpointDigestIndependentlyVerified": False,
        "sourceDicomSOPVoxelLocalizationVerified": False,
        "expertHydrocephalusGroundTruthAvailable": False,
        "diagnosisOfHydrocephalus": None,
        "absenceOfHydrocephalusEstablished": False,
        "independentClinicalValidation": False,
        "patientUseAllowed": False,
        "researchOnly": True,
        "limitations": [
            "Evans index is a morphometric ventriculomegaly review flag, not hydrocephalus diagnosis.",
            "Vendor algorithm uses atlas registration and dilated brain as inner-skull surrogate, not raw DICOM clinical calipers.",
            "Pediatric, postsurgical, partial-brain scans and severe malregistration must be excluded by medical review.",
            "A value below 0.30 does not exclude normal pressure hydrocephalus or other diseases.",
            "Model assets match a supplied manifest, not independently checked publisher checkpoint SHA.",
            "No matching expert CT diagnosis, sensitivity, specificity or source-image radiologist review.",
            "Only publicly licensed deidentified studies in an isolated network-disabled container; no patients/LLM."
        ],
    }


def run(ct: Path, weights: Path, manifest: Path, result_path: Path,
        image: str, license_name: str, source_url: str, timeout: int = 3600):
    if (os.name != "posix" or not Path("/proc/meminfo").is_file() or
        result_path.exists() or result_path.is_symlink() or
        result_path.suffix != ".json" or not result_path.parent.is_dir()):
        raise ValueError("dedicated_Linux_research_worker_and_new_JSON_required")
    if not IMAGE_PATTERN.fullmatch(image):
        raise ValueError("vendor_OCI_image_must_be_SHA256_pinned")
    if not 30 <= timeout <= 7200:
        raise ValueError("unbounded_vendor_inference_timeout")
    geometry = inspect_ct(ct)
    provenance = preflight_weights(weights, manifest)
    if license_name not in ALLOWED_LICENSES or not source_url.startswith("https://"):
        raise ValueError("approved_licensed_public_research_CT_only")
    source_sha = file_hash(ct)
    with tempfile.TemporaryDirectory(prefix="opus-public-evans-") as folder:
        report_dir = Path(folder)
        cmd = [
            "docker", "run", "--rm", "--pull", "never", "--network", "none",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--memory", "24g", "--pids-limit", "512", "--ipc", "private",
            "--user", f"{os.getuid()}:{os.getgid()}",
            "--tmpfs", "/tmp:rw,nosuid,nodev,size=8g,mode=1777",
            "--mount", f"type=bind,source={ct.resolve()},target=/input/ct.nii.gz,readonly",
            "--mount", f"type=bind,source={weights.resolve()},target=/models,readonly",
            "--mount", f"type=bind,source={report_dir.resolve()},target=/output",
            "--env", "TOTALSEG_HOME_DIR=/models", "--env", "MPLCONFIGDIR=/tmp",
            image, "totalseg_evans_index",
            "-i", "/input/ct.nii.gz", "-o", "/output/vendor.json",
            "-p", "/output/vendor.png",
        ]
        try:
            subprocess.run(cmd, check=True, timeout=timeout, capture_output=True, text=True)
        except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            # Never forward stdout/stderr: original vendor logs can contain paths.
            raise RuntimeError("original_offline_Evans_vendor_inference_failed") from None
        vendor = report_dir / "vendor.json"
        if vendor.is_symlink() or not vendor.is_file() or not 10 <= vendor.stat().st_size <= 10000:
            raise ValueError("missing_or_unbounded_vendor_report")
        raw = json.loads(vendor.read_text("utf-8"))
        result = interpret_vendor_report(raw, provenance, geometry, source_sha,
                                         image, license_name, source_url)
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", required=True, type=Path)
    p.add_argument("--weights-dir", required=True, type=Path)
    p.add_argument("--weights-manifest", required=True, type=Path)
    p.add_argument("--executor-image", required=True)
    p.add_argument("--output", required=True, type=Path)
    p.add_argument("--source-license", required=True)
    p.add_argument("--source-url", required=True)
    p.add_argument("--timeout-seconds", type=int, default=3600)
    p.add_argument("--approved-deidentified-public-head-CT-only", action="store_true")
    args = p.parse_args()
    if not args.approved_deidentified_public_head_CT_only:
        p.error("Research source permission and deidentification required; no patient input")
    evidence = run(args.ct, args.weights_dir, args.weights_manifest,
                   args.output, args.executor_image, args.source_license, args.source_url,
                   args.timeout_seconds)
    print(json.dumps({"schema": SCHEMA, "evansIndex": evidence["evansIndex"],
                      "studyIsNotClinicalDiagnosis": True}))


if __name__ == "__main__":
    main()
