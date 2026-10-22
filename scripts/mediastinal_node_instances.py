"""Source-native mediastinal node mask instance statistics (research only)."""
import numpy as np
from scipy.ndimage import label


def measure_nodes(mask, affine):
    if mask.ndim != 3 or affine.shape != (4, 4):
        raise ValueError("Expected 3D binary mask and 4x4 affine")
    if not np.isfinite(affine).all() or abs(np.linalg.det(affine[:3, :3])) < 1e-8:
        raise ValueError("Invalid spatial geometry")
    if not np.isin(mask, [0, 1]).all():
        raise ValueError("Mediastinal prediction must be binary")
    # 26-connected candidates: adjacent voxels are a single potential node.
    indexed, n = label(mask.astype(bool), structure=np.ones((3, 3, 3), dtype=np.uint8))
    factor = float(abs(np.linalg.det(affine[:3, :3])) / 1000)
    nodes = []
    for i in range(1, n + 1):
        ijk = np.argwhere(indexed == i)
        xyz = ijk @ affine[:3, :3].T + affine[:3, 3]
        nodes.append({
            "volumeMl": round(len(ijk) * factor, 6),
            "voxelCount": int(len(ijk)),
            "centroidRASmm": xyz.mean(axis=0).tolist(),
            "boundsRASmm": [xyz.min(axis=0).tolist(), xyz.max(axis=0).tolist()],
            "voxelBounds": [ijk.min(axis=0).tolist(), ijk.max(axis=0).tolist()],
            "candidateOnly": True,
        })
    nodes.sort(key=lambda x: x["voxelCount"], reverse=True)
    for i, node in enumerate(nodes, 1):
        node["candidateIndex"] = i
    return nodes


if __name__ == "__main__":
    a = np.zeros((7, 8, 9), dtype=np.uint8)
    a[1:3, 1:3, 1:3] = 1
    a[5, 6, 7] = 1
    geometry = np.diag([1., 2., 3., 1.])
    nodes = measure_nodes(a, geometry)
    assert len(nodes) == 2 and nodes[0]["voxelCount"] == 8
    assert abs(nodes[0]["volumeMl"] - 0.048) < 1e-8
    print("Mediastinal candidate geometry PASS")
