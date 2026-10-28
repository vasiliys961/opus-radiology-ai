#!/usr/bin/env python3
"""Genuine optional pretrained abdominal CT pathology inference (research only).

Two distinct original TotalSegmentator 2.18.0 tasks:
  kidney_cysts   -> kidney_cyst_left, kidney_cyst_right
  liver_lesions  -> liver_lesions (NOT necessarily cancer)
The host MUST provide licensed original pretrained weights, network isolation,
a rights-cleared original native HU CT and >=10 GiB free RAM. Nothing downloads
in this process. Technical injected inference is never called a real model run.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import platform
import re
from pathlib import Path

from totalsegmentator_input import inspect_input

VERSION = "2.18.0"
AUTH = "PUBLIC-ABDOMINAL-CT-RESEARCH-OK"
MIN_RAM = 10 * 1024**3
TASKS = {
    "kidney_cysts": {1: "kidney_cyst_left", 2: "kidney_cyst_right"},
    "liver_lesions": {1: "liver_lesions"},
}


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def inspect_admission(path, task, source_sha):
    p = Path(path)
    if p.is_symlink() or not p.is_file() or p.stat().st_size > 4096:
        raise ValueError("invalid_private_source_admission")
    data = json.loads(p.read_text())
    required = ("sourcePublicAndRightsCleared", "imageLicenseReviewed",
                "researchOnly", "originalHuVolumeVerified",
                "notPatientData", "modelLicenseReviewed")
    if (not isinstance(data, dict) or
        data.get("schema") != "opus-abdominal-ct-pathology-admission/v1" or
        data.get("task") != task or data.get("sourceNiftiSha256") != source_sha or
        any(data.get(field) is not True for field in required)):
        raise ValueError("research_source_or_model_authorization_unverified")
    return data


def source_mask_evidence(source, mask, source_sha, checkpoint_sha, task):
    """Analyze actual integer model voxels on identical native-mm CT grid."""
    import nibabel as nib
    import numpy as np
    if task not in TASKS:
        raise ValueError("unrecognized_original_pathology_task")
    src = nib.load(str(source), mmap=True)
    seg = nib.load(str(mask), mmap=True)
    if (src.ndim != 3 or seg.ndim != 3 or src.shape != seg.shape or
        src.header.get_xyzt_units()[0] != "mm" or
        seg.header.get_xyzt_units()[0] != "mm" or
        seg.header.get_data_dtype().kind not in "iu"):
        raise ValueError("native_source_mask_shape_or_label_type_mismatch")
    affine = np.asarray(src.affine, dtype=np.float64)
    other = np.asarray(seg.affine, dtype=np.float64)
    if (not np.all(np.isfinite(affine)) or not np.all(np.isfinite(other)) or
        abs(np.linalg.det(affine[:3, :3])) < 1e-6):
        raise ValueError("invalid_physical_grid")
    dims = src.shape
    for i in (0, dims[0] - 1):
        for j in (0, dims[1] - 1):
            for k in (0, dims[2] - 1):
                p = np.array([i, j, k, 1.0])
                if np.linalg.norm((affine @ p)[:3] - (other @ p)[:3]) > 0.05:
                    raise ValueError("pretrained_model_mask_not_in_original_CT_grid")
    if not np.isclose(float(seg.dataobj.slope), 1, atol=1e-9) or not np.isclose(
            float(seg.dataobj.inter), 0, atol=1e-9):
        raise ValueError("rescaled_integer_pathology_labels_rejected")
    image = np.asanyarray(seg.dataobj)
    if not np.isin(image, [0, *TASKS[task]]).all():
        raise ValueError("unknown_original_model_pathology_class")
    voxel_ml = abs(float(np.linalg.det(affine[:3, :3]))) / 1000
    proposals = []
    for label, pathology in TASKS[task].items():
        # Keep candidate mask estimates separate from clinical diagnosis.
        count = 0
        bounds_min = [dims[0], dims[1], dims[2]]
        bounds_max = [-1, -1, -1]
        slices = []
        for k in range(dims[2]):
            ys, xs = np.where(image[:, :, k] == label)
            if ys.size == 0:
                continue
            count += int(ys.size)
            slices.append(k)
            bounds_min = [min(bounds_min[0], int(ys.min())),
                          min(bounds_min[1], int(xs.min())),
                          min(bounds_min[2], k)]
            bounds_max = [max(bounds_max[0], int(ys.max())),
                          max(bounds_max[1], int(xs.max())),
                          max(bounds_max[2], k)]
        world_bounds = None
        if count:
            corners = [
                (affine @ np.array([i, j, k, 1.0]))[:3]
                for i in (bounds_min[0], bounds_max[0])
                for j in (bounds_min[1], bounds_max[1])
                for k in (bounds_min[2], bounds_max[2])
            ]
            world_bounds = {
                "rasMinMm": [round(float(min(p[q] for p in corners)), 4) for q in range(3)],
                "rasMaxMm": [round(float(max(p[q] for p in corners)), 4) for q in range(3)],
            }
        proposals.append({
            "labelId": label, "pathologyClass": pathology,
            "modelCandidateVoxels": count,
            "modelCandidateVolumeMl": round(count * voxel_ml, 5),
            "nativeBoundsMinXYZ": bounds_min if count else None,
            "nativeBoundsMaxXYZ": bounds_max if count else None,
            "nativeSliceIndicesK": slices, "worldRasBoundsMm": world_bounds,
            "physicianVerified": False, "negativeIfEmptyPermitted": False,
        })
    return {
        "schema": "opus-real-abdominal-ct-pathology-proposals/v1",
        "task": task, "model": "TotalSegmentator", "version": VERSION,
        "sourceNiftiSha256": source_sha, "outputNativeMaskSha256": digest(mask),
        "observedCheckpointFileSha256": checkpoint_sha,
        "checkpointActuallyUsedByVendorProven": False,
        "sourceDimensionsXYZ": list(dims), "sourceVoxelVolumeMl": voxel_ml,
        "nativeGeometryMatchedMaxCornerErrorMm": 0.05,
        "proposals": proposals, "clinicallyValidated": False,
        "negativeDiagnosisPermitted": False,
        "limitations": [
            "Original checkpoint SHA checks a file, not the vendor internal loader.",
            "Source admission is an operator attestation, not an independent DICOM/HU audit.",
            "Model candidate volumes are not a clinical diagnosis or Bosniak classification.",
            "Liver lesion means a nonspecific candidate, NOT liver cancer.",
            "Zero positive voxels does not exclude disease; no independent held-out sensitivity.",
            "This report is native NIfTI-bound; no DICOM SOP localization is claimed.",
        ],
    }


def run(task, source, output_mask, output_json, checkpoint, checkpoint_sha256,
        admission, authorization, *, inference=None, runtime_version=None,
        available_ram_bytes=None):
    if task not in TASKS:
        raise ValueError("unknown_pathology_task")
    if authorization != AUTH:
        raise ValueError("explicit_nonpatient_research_authorization_required")
    s, m, r, w = [Path(p) for p in (source, output_mask, output_json, checkpoint)]
    if (s.is_symlink() or w.is_symlink() or not s.is_file() or not w.is_file() or
        s.suffix != ".nii" or w.suffix not in (".pth", ".pt") or
        not (1024 < w.stat().st_size < 1024**3) or
        m.exists() or r.exists() or m.is_symlink() or r.is_symlink() or
        not m.name.endswith((".nii", ".nii.gz")) or r.suffix != ".json" or
        m.parent.resolve() != r.parent.resolve() or
        len({p.resolve() for p in (s, m, r, w)}) != 4):
        raise ValueError("invalid_private_research_input_or_output_path")
    dims = inspect_input(s)["dimensions"]
    if dims[2] < 8:
        raise ValueError("insufficient_abdominal_ct_slices")
    source_sha = digest(s)
    inspect_admission(admission, task, source_sha)
    if (not isinstance(checkpoint_sha256, str) or
        not re.fullmatch(r"[0-9a-f]{64}", checkpoint_sha256) or
        digest(w) != checkpoint_sha256):
        raise ValueError("original_checkpoint_digest_mismatch")
    if inference is None:
        if platform.system() != "Linux":
            raise ValueError("separate_linux_CPU_host_required")
        import psutil
        free = psutil.virtual_memory().available
        version = importlib.metadata.version("TotalSegmentator")
    else:
        # For CI contract tests ONLY. Never claim simulated original inference.
        free = available_ram_bytes
        version = runtime_version
    if version != VERSION or not isinstance(free, int) or free < MIN_RAM:
        raise ValueError("original_model_runtime_or_resource_unavailable")
    if inference is None:
        # Caller must enforce NETWORK ISOLATION and OS/cgroup memory limits.
        from totalsegmentator.python_api import totalsegmentator
        inference = totalsegmentator
        authentic = True
    else:
        authentic = False
    try:
        inference(input=s, output=m, task=task, ml=True, device="cpu", quiet=True)
        if m.is_symlink() or not m.is_file() or m.stat().st_size > 256 * 1024**2:
            raise ValueError("original_model_mask_missing_or_oversized")
        report = source_mask_evidence(s, m, source_sha, checkpoint_sha256, task)
        report["execution"] = {
            "actualPretrainedInferenceClaimed": authentic,
            "mode": "isolated-original-model" if authentic else "synthetic-technical-test",
            "networkIsolationEnforcedByCaller": False,
        }
        r.write_text(json.dumps(report, indent=2), encoding="utf-8")
        return report
    except BaseException:
        r.unlink(missing_ok=True)
        if m.is_file() and not m.is_symlink():
            m.unlink()
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--task", choices=sorted(TASKS), required=True)
    for name in ("source", "output-mask", "output-json", "checkpoint",
                 "checkpoint-sha256", "source-admission", "authorization"):
        parser.add_argument("--" + name, required=True)
    a = parser.parse_args()
    result = run(a.task, a.source, a.output_mask, a.output_json, a.checkpoint,
                 a.checkpoint_sha256, a.source_admission, a.authorization)
    print(json.dumps({
        "task": result["task"], "sourceNiftiSha256": result["sourceNiftiSha256"],
        "outputMaskSha256": result["outputNativeMaskSha256"],
        "actualPretrainedInferenceClaimed": result["execution"]["actualPretrainedInferenceClaimed"],
        "clinicalValidation": False,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
