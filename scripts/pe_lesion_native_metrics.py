"""Source-native 3D PE candidate/expert components from genuine CTPA masks.

26-connected component one-to-one overlap is a research detection endpoint, NOT
clinical validation. Returned numbers and coordinates never include CT pixels.
"""
from __future__ import annotations

MAX_COMPONENTS = 2500
MAX_EXPORTED_CANDIDATES = 40


def score_pe_components(expert, predicted, affine, *, source_units_mm):
    import numpy as np
    from scipy import ndimage

    if type(source_units_mm) is not bool:
        raise ValueError("explicit original NIfTI millimetre verification required")
    e = np.asarray(expert)
    p = np.asarray(predicted)
    t = np.asarray(affine, dtype=float)
    if (e.ndim != 3 or e.shape != p.shape or e.dtype != np.bool_
            or p.dtype != np.bool_ or t.shape != (4, 4)
            or not np.isfinite(t).all()
            or abs(float(np.linalg.det(t[:3, :3]))) < 1e-8):
        raise ValueError("requires source-matched binary 3D masks and finite affine")
    if not e.any():
        raise ValueError("PE lesion comparison requires expert-positive reference")
    connectivity = np.ones((3, 3, 3), dtype=np.uint8)
    ref_labels, n_ref = ndimage.label(e, structure=connectivity)
    pred_labels, n_pred = ndimage.label(p, structure=connectivity)
    if n_ref > MAX_COMPONENTS or n_pred > MAX_COMPONENTS:
        raise ValueError("too many 3D components for reliable research scoring")
    overlap = p & e
    pairs = (pred_labels[overlap].astype(np.int64) * (n_ref + 1)
             + ref_labels[overlap].astype(np.int64))
    already_pred, already_ref = set(), set()
    if pairs.size:
        ids, counts = np.unique(pairs, return_counts=True)
        for i in np.argsort(-counts, kind="stable"):
            candidate, lesion = divmod(int(ids[i]), n_ref + 1)
            if (candidate and lesion and candidate not in already_pred
                    and lesion not in already_ref):
                already_pred.add(candidate)
                already_ref.add(lesion)
    vox_volume_ml = float(abs(np.linalg.det(t[:3, :3]))) / 1000
    sizes = np.bincount(pred_labels.ravel(), minlength=n_pred + 1)
    largest = sorted(range(1, n_pred + 1),
                     key=lambda ident: (-int(sizes[ident]), ident))
    slices_by_component = ndimage.find_objects(pred_labels)
    locations = []
    for ident in largest[:MAX_EXPORTED_CANDIDATES]:
        slices = slices_by_component[ident - 1]
        if slices is None:
            continue
        local_coords = np.argwhere(pred_labels[slices] == ident)
        low = [int(s.start) for s in slices]
        high = [int(s.stop - 1) for s in slices]
        center = [float(local_coords[:, j].mean() + low[j]) for j in range(3)]
        ras_mm = (t @ np.array([*center, 1.]))[:3]
        locations.append({
            "originalSourceVoxelBoundsInclusive": [low, high],
            "originalSourceVoxelCentroid": [round(x, 3) for x in center],
            "originalSourceRasMmCentroid": [round(float(x), 3) for x in ras_mm] if source_units_mm else None,
            "candidateVolumeMl": round(int(sizes[ident]) * vox_volume_ml, 5) if source_units_mm else None,
            "voxels": int(sizes[ident]),
            "matchesOneExpertLesion": ident in already_pred,
            "notConfirmedPE": True,
        })
    matches = len(already_ref)
    return {
        "expertConnectedPEComponents": int(n_ref),
        "modelConnectedPECandidates": int(n_pred),
        "expertPEComponentsMatchedOneToOne": matches,
        "expertPEComponentsMissed": int(n_ref - matches),
        "unmatchedModelPEComponentsPerOneStudy": int(n_pred - len(already_pred)),
        "singleStudyComponentRecall": round(matches / n_ref, 6),
        "singleStudyFalsePositiveCandidateCount": int(n_pred - len(already_pred)),
        "componentConnectivity": 26,
        "originalSourcePhysicalMillimetresVerified": source_units_mm,
        "componentMatchingRule": "greedy one-to-one any-voxel overlap descending shared voxels",
        "candidateLocationsOriginalSourceRasMm": locations,
        "candidateLocationListTruncated": n_pred > MAX_EXPORTED_CANDIDATES,
        "negativePEExclusionNotEstablished": True,
        "independentClinicalValidation": False,
    }
