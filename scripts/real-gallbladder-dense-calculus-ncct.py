#!/usr/bin/env python3
"""Dense gallbladder calculus CT candidate extractor, NOT gallstone diagnosis.

Consumes source-native true-HU noncontrast CT and externally trained original
gallbladder anatomy mask; cannot see radiolucent stones, sludge reliably, or
exclude acute cholecystitis. No pre-trained pathology detector is claimed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import math

MAX_BYTES = 750*1024**2
MAX_VOXELS = 512*512*500


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for c in iter(lambda: f.read(1024*1024), b""):
            h.update(c)
    return h.hexdigest()


def load_img(path):
    import numpy as np
    import nibabel as nib
    if path.is_symlink() or not path.is_file() or not 120 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("original_CT_or_anatomical_mask_unavailable")
    x = nib.load(str(path))
    a = x.affine
    if len(x.shape) != 3 or math.prod(x.shape) > MAX_VOXELS or not np.isfinite(a).all():
        raise ValueError("invalid_original_source_volume")
    if not np.allclose(a[3], (0, 0, 0, 1)):
        raise ValueError("invalid_source_affine")
    mm = np.linalg.norm(a[:3, :3], axis=0)
    if (np.any(mm < .2) or np.any(mm > 4) or
            abs(np.linalg.det(a[:3, :3])) < .008 or
            abs(a[2, 2]/mm[2]) < .98):
        raise ValueError("native_axial_CT_required")
    return x, mm


def get_candidates(ct_path, mask_path, threshold):
    import numpy as np
    from scipy.ndimage import distance_transform_edt, label, find_objects
    if not 150 <= threshold <= 350:
        raise ValueError("unvalidated_or_unsafe_research_HU_threshold")
    ct, mm = load_img(ct_path)
    mask, _ = load_img(mask_path)
    if (ct.shape != mask.shape or
            not np.allclose(ct.affine, mask.affine, atol=.02, rtol=0)):
        raise ValueError("native_original_CT_mask_grid_mismatch")
    if mask.get_data_dtype().kind not in "biu":
        raise ValueError("source_anatomical_mask_noninteger")
    occupied = []
    bounds = []
    for k in range(mask.shape[2]):
        p = np.asarray(mask.dataobj[:, :, k])
        if not np.isin(p, (0, 1)).all():
            raise ValueError("gallbladder_mask_must_be_binary")
        a = np.argwhere(p == 1)
        if a.size:
            occupied.append(k)
            bounds.append([int(a[:,0].min()),int(a[:,0].max()),
                           int(a[:,1].min()),int(a[:,1].max())])
    if len(occupied) < 3:
        raise ValueError("absent_or_uncovered_gallbladder_is_not_negative")
    # Process only the organ bounding ROI, not a giant full CT array.
    low = [max(0, min(x[0] for x in bounds)-3),
           max(0, min(x[2] for x in bounds)-3), max(0, occupied[0]-2)]
    high = [min(ct.shape[0], max(x[1] for x in bounds)+4),
            min(ct.shape[1], max(x[3] for x in bounds)+4),
            min(ct.shape[2], occupied[-1]+3)]
    sl = tuple(slice(x,y) for x,y in zip(low,high))
    m = np.asarray(mask.dataobj[sl]) == 1
    source = np.asarray(ct.dataobj[sl], dtype=np.float32)
    if not np.isfinite(source).all() or np.any(source < -1200) or np.any(source > 6500):
        raise ValueError("not_a_calibrated_source_HU_volume")
    # Suppress the 2.5mm immediately adjacent luminal wall in each axial
    # plane; gallbladder anatomy masks may still include wall and nearby calcifications.
    interior = np.zeros_like(m, dtype=bool)
    for z in range(m.shape[2]):
        interior[:, :, z] = distance_transform_edt(
            m[:, :, z], sampling=(mm[0],mm[1])) >= 2.5
    high_hu = interior & (source >= threshold)
    components, n = label(high_hu)
    if n > 2000:
        raise ValueError("unsafe_dense_component_count")
    out = []
    for idx, span in enumerate(find_objects(components), 1):
        if span is None:
            continue
        piece = components[span] == idx
        cnt = int(piece.sum())
        if cnt < 3:
            continue
        local = np.argwhere(piece)
        p0 = np.array([s.start for s in span])+low
        center = p0 + local.mean(axis=0)
        src_bounds_min = (np.array([s.start for s in span])+low).tolist()
        src_bounds_max = (np.array([s.stop-1 for s in span])+low).tolist()
        world = ct.affine @ np.r_[center,1]
        hu = source[span][piece]
        out.append({"candidateIndex":len(out), "sourceVoxelCount":cnt,
                    "sourceVoxelBoundsInclusive":[src_bounds_min,src_bounds_max],
                    "centroidRasMm":[round(float(x),3) for x in world[:3]],
                    "candidateVolumeMm3":round(cnt*abs(float(np.linalg.det(ct.affine[:3,:3]))),3),
                    "meanOriginalHU":round(float(hu.mean()),2),
                    "peakOriginalHU":round(float(hu.max()),2)})
    return {"sourceCTSHA256":digest(ct_path),"sourceAnatomyMaskSHA256":digest(mask_path),
            "thresholdHU":threshold,"sourceMaskOccupiedSlices":len(occupied),
            "interiorCandidateVoxelCount":int(high_hu.sum()),"candidates":out,
            "noRadiolucentStonesCanBeExcluded":True,
            "noAcuteCholecystitisOrBileDuctAssessment":True,
            "notASpecialistGallstoneTrainedDetector":True,"negativeStudy":False}


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--ct",type=Path,required=True)
    p.add_argument("--ct-sha256",required=True)
    p.add_argument("--gallbladder-mask",type=Path,required=True)
    p.add_argument("--gallbladder-mask-sha256",required=True)
    p.add_argument("--threshold-hu",type=int,default=180)
    p.add_argument("--public-source-url",required=True)
    p.add_argument("--public-source-license",required=True)
    p.add_argument("--approved-public-research",action="store_true")
    p.add_argument("--noncontrast-CT-confirmed",action="store_true")
    p.add_argument("--original-HU-calibrated",action="store_true")
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    if (not a.approved_public_research or not a.noncontrast_CT_confirmed
            or not a.original_HU_calibrated or
            not a.public_source_url.startswith("https://") or
            not a.public_source_license.strip()):
        p.error("public_noncontrast_HU_and_license_required")
    if (digest(a.ct)!=a.ct_sha256.lower() or
            digest(a.gallbladder_mask)!=a.gallbladder_mask_sha256.lower()):
        p.error("source_model_anatomy_input_SHA256_mismatch")
    result=get_candidates(a.ct,a.gallbladder_mask,a.threshold_hu)
    result.update({"schema":"opus-CT-gallbladder-hyperattenuation-candidate/v1",
        "licensedOriginalPublicSource":a.public_source_url,
        "publicSourceLicense":a.public_source_license,
        "originalHUAndNoncontrastAttestedNotIndependentlyVerified":True,
        "separateAnatomyModelProvenanceNotAuthenticated":True,
        "clinicallyValidated":False,"patientCloudTransfer":False})
    if a.output.is_symlink() or a.output.exists():
        p.error("report_output_must_be_new")
    a.output.parent.mkdir(exist_ok=True,parents=True)
    a.output.write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps({"candidateCount":len(result["candidates"]),
                      "genuineStoneDetector":False,"clinicallyValidated":False}))


if __name__=="__main__":
    main()
