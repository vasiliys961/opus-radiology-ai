#!/usr/bin/env python3
"""Opportunistic native-CT cardiovascular geometry, research-only.

Reuses already-produced TotalSegmentator 'total' ANATOMICAL masks. Does not
run a model or classify aneurysm, cardiomegaly, pulmonary hypertension, etc.
Images/masks never leave caller's isolated system; output is numeric only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

LABELS = {
    "heart", "aorta", "superior_vena_cava", "inferior_vena_cava",
    "portal_vein_and_splenic_vein", "iliac_artery_left", "iliac_artery_right",
    "iliac_vena_left", "iliac_vena_right",
}
MAX_BYTES = 750 * 1024**2
MAX_VOXELS = 512 * 512 * 500


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def checked_image(path: Path):
    import nibabel as nib
    import numpy as np
    if (path.is_symlink() or not path.is_file() or
            not 256 <= path.stat().st_size <= MAX_BYTES):
        raise ValueError("missing_or_unbounded_public_NIfTI")
    img = nib.load(str(path))
    a = img.affine
    if (len(img.shape) != 3 or min(img.shape) < 8 or
            math.prod(img.shape) > MAX_VOXELS or
            not np.isfinite(a).all() or not np.allclose(a[3], [0, 0, 0, 1])):
        raise ValueError("invalid_or_unbounded_native_CT_geometry")
    axes = a[:3, :3]
    spacings = np.linalg.norm(axes, axis=0)
    if (np.any(spacings < .2) or np.any(spacings > 10) or
            abs(np.linalg.det(axes)) < .008):
        raise ValueError("implausible_native_voxel_spacing")
    return img


def measure(ct, label: str, path: Path) -> dict:
    import numpy as np
    mask = checked_image(path)
    if (mask.shape != ct.shape or
            not np.allclose(mask.affine, ct.affine, rtol=0, atol=.02)):
        raise ValueError("mask_not_source_CT_grid")
    if mask.get_data_dtype().kind not in "biu":
        raise ValueError("noninteger_binary_anatomy_mask")
    spacing = np.linalg.norm(ct.affine[:3, :3], axis=0)
    axial = (abs(ct.affine[2, 0]/spacing[0]) < .2 and
             abs(ct.affine[2, 1]/spacing[1]) < .2 and
             abs(ct.affine[2, 2]/spacing[2]) > .98 and
             abs(float(np.dot(ct.affine[:3, 0], ct.affine[:3, 1]))) <
             .02 * float(spacing[0]*spacing[1]))
    n = 0
    ijk_sum = np.zeros(3, dtype=np.float64)
    bounds_min = np.full(3, np.inf)
    bounds_max = np.full(3, -np.inf)
    boundary = False
    slices = []
    voxel_area = float(np.linalg.norm(np.cross(ct.affine[:3, 0], ct.affine[:3, 1])))
    for start in range(0, ct.shape[2], 8):
        block = np.asarray(mask.dataobj[:, :, start:start+8])
        if not np.isin(block, (0, 1)).all():
            raise ValueError("mask_not_binary_anatomical_segmentation")
        for index in range(block.shape[2]):
            plane = block[:, :, index] == 1
            count = int(np.count_nonzero(plane))
            if not count:
                continue
            i, j = np.nonzero(plane)
            k = start+index
            n += count
            ijk_sum += [float(i.sum()), float(j.sum()), float(k*count)]
            mins = [int(i.min()), int(j.min()), k]
            maxs = [int(i.max()), int(j.max()), k]
            bounds_min = np.minimum(bounds_min, mins)
            bounds_max = np.maximum(bounds_max, maxs)
            boundary |= (mins[0] == 0 or mins[1] == 0 or k == 0 or
                         maxs[0] == ct.shape[0]-1 or maxs[1] == ct.shape[1]-1 or
                         k == ct.shape[2]-1)
            # Axial area-equivalent diameter of the segmentation, NOT external
            # outer-wall / orthogonal-to-vessel diameter.
            if axial:
                slices.append({"sliceIndex": k, "areaMm2": round(count*voxel_area, 3),
                               "areaEquivalentDiameterMm":
                               round(2*math.sqrt(count*voxel_area/math.pi), 3)})
    if n == 0:
        return {"label": label, "sourceMaskSHA256": sha256(path),
                "maskEmpty": True, "negativeStudy": False,
                "volumeMl": None, "centroidRasMm": None,
                "candidateAxialDiameterMm": None}
    center = ijk_sum/n
    world = ct.affine @ np.r_[center, 1.0]
    return {
        "label": label, "sourceMaskSHA256": sha256(path),
        "maskEmpty": False, "negativeStudy": False,
        "maskVoxelCount": n,
        "volumeMl": round(n*abs(float(np.linalg.det(ct.affine[:3, :3])))/1000, 4),
        "sourceVoxelBoundingBoxInclusive": [bounds_min.astype(int).tolist(),
                                             bounds_max.astype(int).tolist()],
        "centroidRasMm": [round(float(x), 3) for x in world[:3]],
        "touchesSourceVolumeBoundary": bool(boundary),
        "candidateAxialDiameterMm": (max(s["areaEquivalentDiameterMm"] for s in slices)
                                    if slices else None),
        "candidateAxialDiameterSourceSlice": (max(slices,
            key=lambda s: s["areaEquivalentDiameterMm"])["sliceIndex"] if slices else None),
        "notCenterlineOrthogonalOrExternalWallCaliper": True,
        "partialAnatomyCannotBeExcluded": True,
    }


def evaluate(ct_path: Path, names_and_paths, source_sha: str, source_url: str,
             source_license: str) -> dict:
    if (not source_url.startswith("https://") or len(source_sha) != 64 or
            any(ch not in "0123456789abcdef" for ch in source_sha.lower()) or
            not source_license.strip()):
        raise ValueError("public_source_provenance_required")
    if sha256(ct_path) != source_sha.lower():
        raise ValueError("source_CT_SHA256_mismatch")
    if not names_and_paths:
        raise ValueError("at_least_one_anatomical_mask_required")
    ct = checked_image(ct_path)
    results = {}
    for name, path in names_and_paths:
        if name not in LABELS or name in results:
            raise ValueError("unsupported_or_duplicate_anatomical_label")
        results[name] = measure(ct, name, path)
    return {
        "schema": "opus-native-cardiovascular-CT-anatomy-measurements/v1",
        "sourceCTSHA256": source_sha.lower(), "publicSourceURL": source_url,
        "researchSourceLicense": source_license, "model": "external_original_anatomical_masks",
        "modelCheckpointSHA256VerifiedByThisReport": False,
        "genuinePretrainedInferencePerformedByThisScript": False,
        "nativeNiftiRasWorldCoordinates": True, "dicomSopLocalizationVerified": False,
        "patientCloudTransfer": False, "clinicallyValidated": False,
        "noCoronaryStenosisOrCardiacFunctionConclusion": True,
        "noVascularDiseaseOrNormalStudyConclusion": True, "measurements": results,
    }


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--ct-sha256", required=True)
    p.add_argument("--mask", action="append", required=True,
                   help="Anatomical label=path/to/native_mask.nii.gz")
    p.add_argument("--public-source-url", required=True)
    p.add_argument("--public-source-license", required=True)
    p.add_argument("--public-deidentified-research", action="store_true")
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    if not a.public_deidentified_research:
        p.error("explicit_public_research_admission_required")
    pairs = []
    for item in a.mask:
        label, sep, filename = item.partition("=")
        if not sep or not filename:
            p.error("--mask must be label=path")
        pairs.append((label, Path(filename)))
    report = evaluate(a.ct, pairs, a.ct_sha256, a.public_source_url,
                      a.public_source_license)
    if a.output.is_symlink() or a.output.exists():
        p.error("output_must_be_new")
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(report, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"sourceCTSHA256": report["sourceCTSHA256"],
                      "anatomicalMeasurements": len(report["measurements"]),
                      "realModelForward": False, "diagnosticValidation": False}))


if __name__ == "__main__":
    main()
