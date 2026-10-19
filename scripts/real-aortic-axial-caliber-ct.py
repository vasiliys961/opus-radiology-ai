#!/usr/bin/env python3
"""Research-only CT aortic calibre triage from a real TotalSegmentator aorta mask.

No model execution/download, infrarenal localisation or automatic aneurysm diagnosis.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

SCHEMA = "opus-aortic-axial-caliber-ct/v1"
VENDOR = "https://github.com/wasserth/TotalSegmentator/tree/v2.18.0"
MAX_BYTES = 750 * 1024 ** 2
MAX_VOXELS = 512 * 512 * 600


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def require_file(path: Path) -> None:
    if path.is_symlink() or not path.is_file() or not 256 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("missing_symlinked_or_unbounded_public_nifti")


def check_grid(shape, affine):
    """Refuse non-axial/sheared grids requiring a dedicated centerline MPR."""
    import numpy as np
    if len(shape) != 3 or min(shape) < 16 or math.prod(shape) > MAX_VOXELS:
        raise ValueError("invalid_or_unbounded_source_volume")
    a = np.asarray(affine, dtype=np.float64)
    if a.shape != (4, 4) or not np.isfinite(a).all() or not np.allclose(a[3], [0, 0, 0, 1]):
        raise ValueError("invalid_source_affine")
    v = a[:3, :3]
    norms = np.linalg.norm(v, axis=0)
    if np.any(norms < .2) or np.any(norms > 10) or abs(np.linalg.det(v)) < .008:
        raise ValueError("unusable_physical_spacing")
    axes = v / norms
    if (abs(np.dot(axes[:, 0], axes[:, 1])) > .02 or
        abs(np.dot(axes[:, 0], axes[:, 2])) > .02 or
        abs(np.dot(axes[:, 1], axes[:, 2])) > .02 or
        abs(axes[2, 2]) < .98 or
        abs(np.cross(axes[:, 0], axes[:, 1])[2]) < .98):
        raise ValueError("non_axial_grid_requires_centerline_MPR")
    return a, float(np.linalg.norm(np.cross(v[:, 0], v[:, 1])))


def measure_axial_caliber(binary_mask, affine):
    """Physical-space candidate calipers: not orthogonal/external-wall measurements."""
    import numpy as np
    from scipy import ndimage
    from scipy.spatial import ConvexHull, distance
    mask = np.asarray(binary_mask)
    a, voxel_area = check_grid(mask.shape, affine)
    if mask.dtype.kind not in "biu" or not np.isin(mask, (0, 1)).all():
        raise ValueError("aorta_mask_must_be_binary_integer")
    if not mask.any():
        raise ValueError("no_aorta_mask_not_a_negative_study")
    per_slice = []
    for k in range(mask.shape[2]):
        ij = mask[:, :, k].astype(bool, copy=False)
        if np.count_nonzero(ij) < 30:
            continue
        groups, count = ndimage.label(ij)
        sizes = np.bincount(groups.ravel())
        sizes[0] = 0
        biggest = int(np.argmax(sizes))
        if not biggest or sizes[biggest] < 30:
            continue
        primary = groups == biggest
        fragmented = count > 1 and (ij.sum() - sizes[biggest]) > max(10, sizes[biggest] * .05)
        edge = primary & ~ndimage.binary_erosion(primary)
        pts_ij = np.column_stack(np.where(edge)).astype(float)
        if len(pts_ij) > 20000:
            raise ValueError("unbounded_aorta_boundary")
        pts_mm = pts_ij @ a[:3, :2].T
        if len(pts_mm) < 3:
            continue
        # Hull in XY only for exactly axial grid; use full 3D calipers if tilted.
        hull = ConvexHull(pts_mm[:, :2]) if abs(a[2, 0]) < 1e-8 and abs(a[2, 1]) < 1e-8 else None
        vertices = pts_mm[hull.vertices] if hull is not None else pts_mm
        feret = float(distance.pdist(vertices).max()) if len(vertices) > 1 else 0.0
        center = np.asarray(ndimage.center_of_mass(primary), dtype=float)
        native = [float(center[0]), float(center[1]), float(k)]
        world = (a @ np.array([*native, 1.0]))[:3].tolist()
        where = np.where(primary)
        per_slice.append({
            "sourceSliceIndex": k,
            "aortaSourceVoxelBox": [
                [int(where[0].min()), int(where[0].max())],
                [int(where[1].min()), int(where[1].max())],
                [k, k],
            ],
            "centroidSourceVoxel": [round(v, 3) for v in native],
            "centroidWorldRASmm": [round(float(v), 3) for v in world],
            "voxelAreaMm2": round(float(sizes[biggest] * voxel_area), 3),
            "axialFeretDiameterMm": round(feret, 3),
            "areaEquivalentDiameterMm": round(2 * math.sqrt(sizes[biggest] * voxel_area / math.pi), 3),
            "fragmentedSlice": bool(fragmented),
        })
    if len(per_slice) < 3:
        raise ValueError("insufficient_aorta_coverage_not_negative")
    return per_slice


def build_evidence(measurements, source_sha, mask_sha, dataset_license, dataset_url):
    if not measurements:
        raise ValueError("missing_spatial_aorta_evidence")
    if dataset_license not in {"CC0", "CC BY 3.0", "CC BY 4.0"}:
        raise ValueError("public_source_license_not_allowlisted")
    if not dataset_url.startswith("https://") or len(dataset_url) > 1024:
        raise ValueError("public_source_url_required")
    if any(len(v) != 64 or any(c not in "0123456789abcdef" for c in v) for v in (source_sha, mask_sha)):
        raise ValueError("original_source_and_mask_sha256_required")
    maximum = max(measurements, key=lambda m: m["axialFeretDiameterMm"])
    candidates = [m for m in measurements if m["axialFeretDiameterMm"] >= 30]
    return {
        "schema": SCHEMA,
        "modality": "CT",
        "task": "aortic_dilatation_axial_morphometric_review_candidate",
        "modelSegmentationSource": "TotalSegmentator v2.18.0 / total / aorta (external segmentation required)",
        "publisherUrl": VENDOR,
        "originalSourceCTSHA256": source_sha,
        "pretrainedAortaMaskSHA256": mask_sha,
        "sourceLicense": dataset_license,
        "sourcePublicURL": dataset_url,
        "sourceToMaskPhysicalGridMatched": True,
        "measuredSliceCount": len(measurements),
        "maximumObservedAxialFeretDiameterMm": maximum["axialFeretDiameterMm"],
        "maximumObservedSlice": maximum,
        "slicesAtOrAbove30Mm": candidates[:256],
        "slicesAtOrAbove30MmCount": len(candidates),
        "possibleDilatationFlagNotDiagnosis": bool(candidates),
        "fragmentedSliceCount": sum(bool(m["fragmentedSlice"]) for m in measurements),
        "infrarenalSegmentIndependentlyLocalized": False,
        "modelInferenceExecutedByThisAdapter": False,
        "trainedCheckpointVerifiedByThisAdapter": False,
        "orthogonalCenterlineCaliperMeasured": False,
        "externalAorticWallVerified": False,
        "expertAneurysmReferenceAvailable": False,
        "expertDiseaseAccuracy": None,
        "automatedDiagnosis": False,
        "absenceOfDiseaseEstablished": False,
        "researchOnly": True,
        "patientUseAllowed": False,
        "limitations": [
            "Source must be licensed public de-identified complete abdominal CT; no patient/LLM transfer.",
            "Supplied aorta mask must come from real pretrained segmentation; provenance is not proven by this adapter.",
            "Axial voxel-center Feret diameter, NOT outer-wall diameter orthogonal to aortic centerline.",
            "Infrarenal level and aneurysm subtype not localized; 30 mm is a review flag, not a AAA diagnosis.",
            "Incomplete masks, thick slices and segmentation errors may cause misses or false flags. No negative screen.",
            "No independent expert validation, verified model checkpoint or clinical authorisation."
        ],
    }


def run(ct_path: Path, mask_path: Path, output: Path, source_license: str, source_url: str):
    import nibabel as nib
    import numpy as np
    if output.exists() or output.is_symlink() or output.suffix != ".json" or not output.parent.is_dir():
        raise ValueError("new_JSON_output_path_required")
    require_file(ct_path)
    require_file(mask_path)
    ct = nib.load(str(ct_path))
    seg = nib.load(str(mask_path))
    if ct.ndim != 3 or seg.shape != ct.shape:
        raise ValueError("aorta_mask_not_exact_native_CT_grid")
    check_grid(ct.shape, ct.affine)
    if (ct.header.get_xyzt_units()[0] != "mm" or seg.header.get_xyzt_units()[0] != "mm" or
        not np.allclose(ct.affine, seg.affine, atol=1e-3, rtol=0) or
        seg.header.get_data_dtype().kind not in "biu"):
        raise ValueError("aorta_mask_not_exact_native_CT_physical_grid")
    measurements = measure_axial_caliber(np.asanyarray(seg.dataobj), ct.affine)
    evidence = build_evidence(measurements, digest(ct_path), digest(mask_path), source_license, source_url)
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return evidence


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ct", required=True, type=Path)
    parser.add_argument("--aorta-mask", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-license", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--public-research-consent", action="store_true")
    args = parser.parse_args()
    if not args.public_research_consent:
        parser.error("Licensed, public, de-identified research CT only; explicit flag required")
    report = run(args.ct, args.aorta_mask, args.output, args.source_license, args.source_url)
    print(json.dumps({
        "schema": report["schema"],
        "measuredSliceCount": report["measuredSliceCount"],
        "reviewFlag": report["possibleDilatationFlagNotDiagnosis"]
    }))


if __name__ == "__main__":
    main()
