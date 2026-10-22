"""Separate original AutoMSC prostate tumor segmentation into 26-connected lesions.

No inference or diagnosis is performed here; inputs must come from an actual
source-verified model mask. Tiny candidates are retained, not silently removed.
"""
import numpy as np
from scipy.ndimage import label


def describe_lesions(mask, affine):
    """Return voxel-exact lesion instances sorted by decreasing volume."""
    if mask.ndim != 3 or affine.shape != (4, 4):
        raise ValueError("3D mask and 4x4 NIfTI affine required")
    if not np.isfinite(affine).all() or abs(np.linalg.det(affine[:3, :3])) < 1e-10:
        raise ValueError("Invalid physical geometry")
    components, count = label(mask == 2, structure=np.ones((3, 3, 3), dtype=np.uint8))
    volume_mm3 = float(abs(np.linalg.det(affine[:3, :3])))
    results = []
    for n in range(1, count + 1):
        voxels = np.argwhere(components == n)
        transformed = voxels @ affine[:3, :3].T + affine[:3, 3]
        results.append({
            "voxels": int(len(voxels)),
            "volumeMl": float(len(voxels) * volume_mm3 / 1000),
            "centroidRASmm": transformed.mean(axis=0).tolist(),
            "voxelBounds": [voxels.min(axis=0).tolist(), voxels.max(axis=0).tolist()],
            "boundsRASmm": [transformed.min(axis=0).tolist(), transformed.max(axis=0).tolist()],
            "researchCandidateOnly": True,
        })
    results.sort(key=lambda r: r["voxels"], reverse=True)
    for i, r in enumerate(results, 1):
        r["lesionId"] = i
    return results


if __name__ == "__main__":
    m = np.zeros((8, 9, 10), dtype=np.uint8)
    m[1:3, 1:3, 1:3] = 2
    m[6, 7, 8] = 2
    a = np.diag([0.5, 0.7, 2, 1])
    r = describe_lesions(m, a)
    assert len(r) == 2 and r[0]["voxels"] == 8 and r[1]["voxels"] == 1
    assert abs(r[0]["volumeMl"] - 0.0056) < 1e-8
    print("lesion-instance geometry contract PASS")
