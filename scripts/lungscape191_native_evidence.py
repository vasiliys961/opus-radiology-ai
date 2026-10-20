"""Source-native, numeric-only research evidence for LungSCAPE Dataset191 masks.

Never diagnose ILD subtypes from Dataset191. Use only after a successful original
nnU-Net prediction. Do not export CT pixels, masks or patient metadata in JSON.
"""
from itertools import product
import json
from pathlib import Path

MAX_VOXELS = 512 * 512 * 512
MAX_FILE_BYTES = 750 * 1024 * 1024


def installed_label_map(dataset_json):
    """Accept only ordinary explicit nnU-Net integer segmentation labels."""
    manifest = json.loads(Path(dataset_json).read_text(encoding="utf-8"))
    if manifest.get("file_ending") != ".nii.gz":
        raise ValueError("Dataset191 file_ending must be .nii.gz")
    channels = manifest.get("channel_names")
    if not isinstance(channels, dict) or list(channels) != ["0"]:
        raise ValueError("Dataset191 must have exactly one channel")
    if str(channels["0"]).strip().lower() not in ("ct", "computed tomography"):
        raise ValueError("Dataset191 channel is not verified CT")
    labels = manifest.get("labels")
    if not isinstance(labels, dict) or not (1 < len(labels) <= 16):
        raise ValueError("missing or excessive original label ontology")
    result = {}
    for name, number in labels.items():
        if (not isinstance(name, str) or not name.strip()
                or type(number) is not int or number < 0 or number > 255
                or number in result):
            raise ValueError("nonstandard or ambiguous Dataset191 labels")
        result[number] = name
    if result.get(0, "").strip().lower() != "background":
        raise ValueError("original background label is not zero")
    if set(result) != set(range(len(result))):
        raise ValueError("nonconsecutive original model labels")
    return result


def _corners_ras(affine, low, high):
    import numpy as np
    coords = np.array([[*p, 1.0] for p in product(
        (low[0], high[0]), (low[1], high[1]), (low[2], high[2]))])
    xyz = (affine @ coords.T).T[:, :3]
    return [[round(float(v), 3) for v in xyz.min(axis=0)],
            [round(float(v), 3) for v in xyz.max(axis=0)]]


def inspect_native_prediction(source, prediction, label_map):
    """Read a mask slice-by-slice; preserve source coordinates and label ontology.

    Volume and RAS-mm coordinates are omitted when the NIfTI spatial unit is
    unknown. Bounds are inclusive voxel indices and not individual lesions.
    """
    import nibabel as nib
    import numpy as np

    src, seg = nib.load(str(source)), nib.load(str(prediction))
    if (src.ndim != 3 or seg.ndim != 3 or src.shape != seg.shape
            or min(src.shape) < 2 or max(src.shape) > 2048
            or int(np.prod(src.shape)) > MAX_VOXELS):
        raise ValueError("unsupported or mismatched original 3D grid")
    if (not np.isfinite(src.affine).all() or not np.isfinite(seg.affine).all()
            or abs(float(np.linalg.det(src.affine[:3, :3]))) < 1e-8):
        raise ValueError("nonfinite or degenerate source affine")
    # Test physical coordinates at opposite corners, not array shape alone.
    for point in (np.array([0, 0, 0, 1.]), np.array([*(s-1 for s in src.shape), 1.])):
        if np.linalg.norm((src.affine @ point - seg.affine @ point)[:3]) > .05:
            raise ValueError("source/mask physical grid mismatch")
    if not np.allclose(src.affine, seg.affine, atol=1e-4, rtol=0):
        raise ValueError("source/mask affine mismatch")
    src_unit = src.header.get_xyzt_units()[0]
    if src_unit != seg.header.get_xyzt_units()[0]:
        raise ValueError("source/mask spatial units mismatch")
    mm = src_unit == "mm"
    if seg.header.get_data_dtype().kind not in "uif":
        raise ValueError("segmentation must contain numeric labels")

    counts = {v: 0 for v in label_map if v}
    lo = {v: [src.shape[0], src.shape[1], src.shape[2]] for v in counts}
    hi = {v: [-1, -1, -1] for v in counts}
    for z in range(src.shape[2]):
        # A single 2D slice; no full-volume float64 copy on small workers.
        plane = np.asarray(seg.dataobj[:, :, z])
        if not np.isfinite(plane).all() or np.any(plane != np.floor(plane)):
            raise ValueError("nonfinite or nonintegral mask values")
        seen = set(int(v) for v in np.unique(plane))
        if not seen.issubset(label_map):
            raise ValueError("mask contains labels absent from original dataset.json")
        for value in seen - {0}:
            xy = np.argwhere(plane == value)
            counts[value] += int(xy.shape[0])
            lo[value] = [min(lo[value][i], int(xy[:, i].min())) for i in (0, 1)] + [
                min(lo[value][2], z)]
            hi[value] = [max(hi[value][i], int(xy[:, i].max())) for i in (0, 1)] + [
                max(hi[value][2], z)]

    spacing = float(abs(np.linalg.det(src.affine[:3, :3])))
    regions = []
    for value in sorted(counts):
        if not counts[value]:
            continue
        item = {
            "originalModelLabelId": value,
            "originalModelLabelNameNotClinicalDiagnosis": label_map[value],
            "voxels": counts[value],
            "sourceVoxelBoundsInclusive": [lo[value], hi[value]],
            "sourceRasMmAxisAlignedBounds": _corners_ras(src.affine, lo[value], hi[value]) if mm else None,
            "volumeMl": round(counts[value] * spacing / 1000, 4) if mm else None,
        }
        regions.append(item)
    return {
        "sourceShape": list(src.shape),
        "sourceSpatialUnit": src_unit,
        "verifiedNativeGrid": True,
        "sourceUnitMillimetresVerified": mm,
        "observedNonbackgroundModelVoxels": sum(counts.values()),
        "regionsByOriginalModelLabelNotConnectedLesions": regions,
        "labelMapFromInstalledModel": {str(k): label_map[k] for k in sorted(label_map)},
        "negativeFindingNotEstablished": True,
        "ggoReticulationHoneycombingUIPNSIPNotClassified": True,
        "clinicalValidation": False,
    }
