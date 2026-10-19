#!/usr/bin/env python3
"""Research-only native-grid audit of original pelvic fracture segmentation.

Requires an actual externally executed pretrained fracture model and the original
public expert fracture mask. This DOES NOT run model inference or certify weights.
Rejects phantom/synthetic provenance and never treats bony anatomy as fracture.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path

SCHEMA = "opus-pelvic-fracture-public-expert-audit/v1"
MAX_BYTES = 500 * 1024**2
MAX_VOXELS = 180_000_000

def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for part in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()

def checked_nifti(path: Path):
    import nibabel as nib
    import numpy as np
    if path.is_symlink() or not path.is_file() or not 64 <= path.stat().st_size <= MAX_BYTES:
        raise ValueError("missing_or_oversize_original_public_nifti")
    image = nib.load(str(path))
    if (image.ndim != 3 or min(image.shape) < 8 or
        math.prod(image.shape) > MAX_VOXELS or
        image.header.get_xyzt_units()[0] != "mm" or
        not np.isfinite(image.affine).all() or
        abs(float(np.linalg.det(image.affine[:3, :3]))) < 1e-5):
        raise ValueError("invalid_original_nifti_physical_grid")
    return image

def evaluate(ct: Path, expert: Path, prediction: Path, provenance: Path):
    import numpy as np
    from scipy import ndimage
    if provenance.is_symlink() or not provenance.is_file():
        raise ValueError("original_model_execution_provenance_required")
    meta = json.loads(provenance.read_text())
    # The author-published source, installed checkpoint SHA and a completed
    # inference transcript must be independently supplied; this is an audit,
    # not a claim that arbitrary incoming masks originate from the network.
    for name in ("sourceSha256", "expertSha256", "predictionSha256",
                 "checkpointSha256", "vendorCodeCommit"):
        if not isinstance(meta.get(name), str) or len(meta[name]) not in (40, 64):
            raise ValueError("unverified_model_or_public_source_provenance")
    if (meta.get("researchOnly") is not True or
        meta.get("actualPretrainedInferenceCompleted") is not True or
        meta.get("modelTask") != "pelvic_fracture_fragment_segmentation" or
        meta.get("sourceSha256") != sha256(ct) or
        meta.get("expertSha256") != sha256(expert) or
        meta.get("predictionSha256") != sha256(prediction)):
        raise ValueError("missing_or_unbound_original_pretrained_fracture_result")
    images = [checked_nifti(p) for p in (ct, expert, prediction)]
    if any(im.shape != images[0].shape or
           not np.allclose(im.affine, images[0].affine, rtol=0, atol=0.05)
           for im in images[1:]):
        raise ValueError("fracture_prediction_or_expert_not_on_native_CT_grid")
    truth = np.asarray(images[1].dataobj)
    result = np.asarray(images[2].dataobj)
    if (images[1].header.get_data_dtype().kind not in "ui" or
        not np.isfinite(result).all() or not np.equal(result, np.rint(result)).all() or
        not np.isin(truth, (0, 1)).all() or
        not np.isin(result, (0, 1)).all()):
        raise ValueError("fracture_mask_must_be_binary_not_bone_anatomy_labels")
    t = truth == 1
    p = result == 1
    n = int(np.count_nonzero(t))
    if n == 0:
        raise ValueError("positive_original_expert_fracture_mask_required")
    tp = int(np.count_nonzero(t & p))
    fp = int(np.count_nonzero(~t & p))
    fn = int(np.count_nonzero(t & ~p))
    components, count = ndimage.label(p, structure=np.ones((3,3,3), dtype=np.uint8))
    boxes = []
    for label_id, slices in enumerate(ndimage.find_objects(components), 1):
        if slices is None:
            continue
        count_voxels = int(np.count_nonzero(components[slices] == label_id))
        if count_voxels < 5:
            continue
        boxes.append({"voxels": count_voxels,
                      "voxelBBox": [[int(s.start), int(s.stop-1)] for s in slices]})
    boxes.sort(key=lambda b: b["voxels"], reverse=True)
    return {
        "schema": SCHEMA, "task": "pelvic_fracture_CT",
        "checkpointSha256": meta["checkpointSha256"],
        "vendorCodeCommit": meta["vendorCodeCommit"],
        "sourceSha256": meta["sourceSha256"],
        "expertSha256": meta["expertSha256"],
        "predictionSha256": meta["predictionSha256"],
        "nativeShape": list(images[0].shape),
        "trueExpertFractureVoxels": n,
        "predictedFractureVoxels": tp+fp,
        "TP": tp, "FP": fp, "FN": fn,
        "voxelDice": round(2*tp/(2*tp+fp+fn), 6),
        "fractureCandidateVoxelBoxes": boxes[:100],
        "nativeGridVerified": True,
        "researchOnly": True,
        "inferenceAttestedBySuppliedManifestNotIndependentlyVerified": True,
        "independentTrainingHoldout": False,
        "clinicalValidation": False,
        "patientUseAllowed": False,
        "notes": [
            "No anatomy-only label was converted to a fracture.",
            "This audit does not execute the original model or independently prove its checkpoint.",
            "Voxel overlap in one public case is not lesion detection sensitivity."
        ]
    }

def main():
    p = argparse.ArgumentParser()
    for name in ("ct", "expert", "prediction", "provenance", "output"):
        p.add_argument("--"+name, type=Path, required=True)
    a = p.parse_args()
    if a.output.exists() or a.output.is_symlink():
        raise ValueError("new_numeric_evidence_destination_required")
    report = evaluate(a.ct, a.expert, a.prediction, a.provenance)
    a.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({k: report[k] for k in
                      ("task", "TP", "FP", "FN", "voxelDice", "clinicalValidation")}))

if __name__ == "__main__":
    main()
