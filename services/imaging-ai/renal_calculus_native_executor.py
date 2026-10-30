#!/usr/bin/env python3
"""Run original TotalSegmentator abdomen anatomy before existing renal HU candidate detector.

Research-only isolated Linux executor. Kidney cyst masks are NEVER kidney anatomy.
"""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent.parent / "scripts" / "real-renal-calculus-ncct-candidates.py"

def load_candidates():
    spec = importlib.util.spec_from_file_location("renal_calculus_candidates", SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("renal_candidate_script_missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def separate_kidneys(source: Path, combined: Path, left: Path, right: Path):
    """TotalSegmentator total labels 3=left kidney, 2=right kidney."""
    import nibabel as nib
    import numpy as np
    src = nib.load(str(source), mmap=True)
    seg = nib.load(str(combined), mmap=True)
    if src.ndim != 3 or seg.ndim != 3 or src.shape != seg.shape:
        raise ValueError("anatomy_and_source_shape_mismatch")
    if not np.allclose(src.affine, seg.affine, atol=1e-3, rtol=0):
        raise ValueError("anatomy_and_source_affine_mismatch")
    labels = np.asanyarray(seg.dataobj)
    if labels.dtype.kind not in "iu" or not np.isin(labels, [0, 1, 2, 3, 5]).all():
        raise ValueError("not_total_abdomen_anatomy_labels")
    header = nib.Nifti1Header()
    header.set_data_dtype(np.uint8)
    header.set_xyzt_units("mm")
    for label, path in ((3, left), (2, right)):
        mask = (labels == label).astype(np.uint8)
        if not np.any(mask):
            raise ValueError("missing_original_kidney_anatomy_label")
        nib.save(nib.Nifti1Image(mask, src.affine, header=header), str(path))

def execute(source: Path, output: Path, license_name: str, source_url: str, threshold: int = 130):
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("new_evidence_destination_required")
    from totalsegmentator_offline_exec import run as totalseg_run
    renal = load_candidates()
    with tempfile.TemporaryDirectory(prefix="opus-real-renal-calculus-") as directory:
        work = Path(directory)
        combined = work / "original-abdomen.nii"
        left, right = work / "kidney-left.nii", work / "kidney-right.nii"
        segment = totalseg_run(source, combined, confirmed=True, profile="abdomen-four-organs")
        if segment.get("execution") != "real-model-call":
            raise ValueError("original_anatomy_model_not_executed")
        separate_kidneys(source, combined, left, right)
        doc = renal.run(source, left, right, output, license_name, source_url, threshold)
        doc["trainedAnatomyModelExecutedByThisAdapter"] = True
        doc["anatomyExecution"] = {
            "model": "TotalSegmentator", "profile": "abdomen-four-organs",
            "reportedExecution": "real-model-call",
            "weightProvenance": "not-independently-verified",
            "originalCombinedMaskSha256": renal.sha256(combined),
        }
        output.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
        return doc

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--ct", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--source-license", required=True)
    p.add_argument("--source-url", required=True)
    p.add_argument("--candidate-hu-threshold", type=int, default=130)
    p.add_argument("--licensed-deidentified-public-NCCT-confirmed", action="store_true")
    args = p.parse_args()
    if not args.licensed_deidentified_public_NCCT_confirmed:
        p.error("authorized public nonpatient NCCT required")
    doc = execute(args.ct, args.output, args.source_license, args.source_url,
                  args.candidate_hu_threshold)
    print(json.dumps({"schema": doc["schema"],
                      "candidates": doc["numberOfCandidateComponents"],
                      "clinicalDiagnosis": False}))

if __name__ == "__main__":
    main()
