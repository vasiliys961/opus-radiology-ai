"""Bounded genuine 3D candidate components from an ORIGINAL predicted NIfTI mask.

Each connected object retains source-voxel boundaries and RAS-mm bounds.
Never describe components as separate clinical diagnoses, especially ILD subtypes.
"""
from itertools import product

MAX_COMPONENT_VOXELS = 12_000_000
MAX_EXPORTED_COMPONENTS_PER_CLASS = 80
MIN_REPORTED_COMPONENT_VOXELS = 10


def inspect_components(source, prediction, label_map):
    import nibabel as nib
    import numpy as np
    from scipy.ndimage import label, find_objects

    src, seg = nib.load(str(source)), nib.load(str(prediction))
    if src.shape != seg.shape or src.ndim != 3 or not np.allclose(src.affine, seg.affine, atol=1e-4, rtol=0):
        raise ValueError("source/prediction native grid mismatch")
    volume_voxels = int(np.prod(src.shape))
    if volume_voxels > MAX_COMPONENT_VOXELS:
        return {
            "componentAnalysisCompleted": False, "componentAnalysisReason": "bounded_volume_limit",
            "candidateComponents": [], "minimumReportedComponentVoxels": MIN_REPORTED_COMPONENT_VOXELS,
            "unreportedTinyComponentsNotClinicalNegatives": True,
        }
    data = np.asarray(seg.dataobj)
    if not np.isfinite(data).all() or not np.equal(data, np.floor(data)).all():
        raise ValueError("original model predicted nonintegral labels")
    if not set(int(v) for v in np.unique(data)).issubset(label_map):
        raise ValueError("original model mask contains undeclared labels")
    spacing = float(abs(np.linalg.det(src.affine[:3, :3])))
    physical = src.header.get_xyzt_units()[0] == "mm"
    structure = np.ones((3, 3, 3), dtype=np.uint8)  # 26-connected voxels
    out = []
    counts_by_label = {}
    for cls in sorted(label_map):
        if cls == 0:
            continue
        binary = data == cls
        if not binary.any():
            continue
        cc, n = label(binary, structure=structure)
        sizes = np.bincount(cc.ravel(), minlength=n + 1)
        candidates = sorted(
            (i for i in range(1, n + 1) if sizes[i] >= MIN_REPORTED_COMPONENT_VOXELS),
            key=lambda i: (-int(sizes[i]), int(i)),
        )
        counts_by_label[str(cls)] = {
            "allConnectedComponents": int(n),
            "atLeastMinimumVoxelCount": len(candidates),
            "exportedComponents": min(len(candidates), MAX_EXPORTED_COMPONENTS_PER_CLASS),
        }
        objects = find_objects(cc)
        for identifier in candidates[:MAX_EXPORTED_COMPONENTS_PER_CLASS]:
            slices = objects[identifier - 1]
            low = [int(s.start) for s in slices]
            high = [int(s.stop) - 1 for s in slices]
            center = [(a + b) / 2 for a, b in zip(low, high)]
            ras = (src.affine @ np.array([*center, 1.0]))[:3].tolist() if physical else None
            corners = np.array([[*p, 1.0] for p in product(*[(a, b) for a, b in zip(low, high)])])
            physical_corners = (src.affine @ corners.T).T[:, :3] if physical else None
            out.append({
                "originalModelLabelId": int(cls),
                "notDiagnosis": True,
                "connectivity": 26,
                "voxels": int(sizes[identifier]),
                "sourceVoxelBoundsInclusive": [low, high],
                "sourceRasMmBBoxCenter": [round(float(v), 3) for v in ras] if physical else None,
                "sourceRasMmAxisAlignedBounds": [
                    [round(float(v), 3) for v in physical_corners.min(axis=0)],
                    [round(float(v), 3) for v in physical_corners.max(axis=0)]
                ] if physical else None,
                "volumeMl": round(int(sizes[identifier]) * spacing / 1000, 4) if physical else None,
            })
        del cc, binary
    return {
        "componentAnalysisCompleted": True,
        "componentAnalysisReason": "genuine_predicted_mask_not_expert_validation",
        "candidateComponents": out,
        "componentsByOriginalLabel": counts_by_label,
        "minimumReportedComponentVoxels": MIN_REPORTED_COMPONENT_VOXELS,
        "unreportedTinyComponentsNotClinicalNegatives": True,
        "clinicalValidation": False,
    }
