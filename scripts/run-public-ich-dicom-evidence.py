#!/usr/bin/env python3
"""One-command public DICOM NCCT -> pinned ianpan genuine forward -> local DICOM Evidence.

Research-only, 8–64 approved single-frame CT images on isolated >=10 GiB RAM
Linux worker. Outputs including SOP UIDs are PRIVATE to the operator, never
print, upload or place them in GitHub. No patient mode, remote API or diagnosis.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
SHA = re.compile(r"^[a-f0-9]{64}$")
CLASSES = {"epidural", "intraparenchymal", "intraventricular", "subarachnoid", "subdural", "any"}


def load_script(filename, name):
    spec = importlib.util.spec_from_file_location(name, SCRIPT_DIR / filename)
    if spec is None or spec.loader is None:
        raise ValueError("missing_audited_ich_script")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def source_order(paths):
    """Rebuild sorted DICOM source plane order; never derive identity from file order."""
    import numpy as np
    import pydicom
    items = []
    for path in paths:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True)
        row = np.asarray([float(v) for v in ds.ImageOrientationPatient[:3]], dtype=float)
        column = np.asarray([float(v) for v in ds.ImageOrientationPatient[3:]], dtype=float)
        normal = np.cross(row, column)
        position = np.asarray([float(v) for v in ds.ImagePositionPatient], dtype=float)
        if not np.isfinite(normal).all() or not np.isfinite(position).all():
            raise ValueError("invalid_dicom_source_plane")
        items.append((float(position @ normal), str(ds.SeriesInstanceUID), str(ds.SOPInstanceUID)))
    items.sort(key=lambda a: a[0])
    if len(items) < 8 or len(items) > 64 or len({s[2] for s in items}) != len(items):
        raise ValueError("invalid_source_sop_order")
    if len({s[1] for s in items}) != 1:
        raise ValueError("mixed_source_dicom_series")
    if any(abs(items[i+1][0]-items[i][0]) < 0.1 for i in range(len(items)-1)):
        raise ValueError("ambiguous_dicom_source_slice_order")
    return [{"slicePositionMm":pos, "seriesUid":series, "sopInstanceUid":sop}
            for pos,series,sop in items]


def bind_model_to_native_evidence(report, native, source_sha, model_id="ianpan/ct-head-hemorrhage-detection"):
    """Local projection of a genuine model result. No masks or fake normal findings."""
    if (not isinstance(report,dict) or report.get("schema")!="opus-ianpan-genuine-public-ich-research/v1" or
        report.get("status")!="genuine_pretrained_inference_requires_independent_validation" or
        report.get("model",{}).get("id")!=model_id or
        report.get("model",{}).get("checkpointSha256Verified") is not True or
        report.get("source",{}).get("niftiSha256")!=source_sha or
        report.get("source",{}).get("sourceOriginalDicomHURescaleIndependentlyVerified") is not True or
        report.get("source",{}).get("modelOrderedSliceCount")!=len(native) or
        report.get("readyForClinicalUse") is not False or
        not SHA.fullmatch(source_sha)):
        raise ValueError("unverified_original_ich_inference_or_source")
    revision = report["model"].get("revision")
    if revision != "e6d89c2":
        raise ValueError("unsupported_original_ich_model_revision")
    candidates = report.get("candidates")
    if not isinstance(candidates,list) or len(candidates)>500:
        raise ValueError("unbounded_ich_candidate_list")
    if (not isinstance(native,list) or len(native)<8 or len(native)>64 or
        len({x["sopInstanceUid"] for x in native})!=len(native) or
        len({x["seriesUid"] for x in native})!=1):
        raise ValueError("source_dicom_identity_not_unique")
    findings = []
    unmappable = 0
    for item in candidates:
        if not isinstance(item,dict) or item.get("class") not in CLASSES:
            raise ValueError("unsupported_ich_output_class")
        roi = item.get("sourceVoxelProjection")
        if roi is None:
            unmappable += 1
            continue
        if not isinstance(roi,dict) or roi.get("projectionMethod") != "vendor_e6d89c2_lps_reorientation_center_pad_inverse_v1":
            raise ValueError("unknown_source_geometry_projection")
        bounds = roi.get("boundingBoxNativeNiftiXYZ")
        if (not isinstance(bounds,list) or len(bounds)!=6 or
            any(type(x) is not int for x in bounds) or
            any(bounds[i]>bounds[i+3] for i in range(3)) or
            bounds[2]!=bounds[5]):
            raise ValueError("unverified_single_source_slice_ich_roi")
        k = bounds[2]
        if not 0 <= k < len(native):
            raise ValueError("source_dicom_plane_out_of_range")
        score = item.get("rawUncalibratedScore")
        if type(score) not in (int,float) or not 0<=score<=1:
            raise ValueError("invalid_original_ich_score")
        slice_ = native[k]
        if len(findings)>=128:
            raise ValueError("too_many_native_ich_findings")
        findings.append({
            "findingId": f"ianpan-public-ich-{len(findings)}",
            "sign": f"Research candidate: {item['class']} hemorrhage pattern (uncalibrated score {score:.3f})",
            "anatomy": "HEAD",
            "status": "requires_recheck",
            "source": {"seriesUid":slice_["seriesUid"],"sopInstanceUid":slice_["sopInstanceUid"],
                       "frameIndex":0,"slicePositionMm":slice_["slicePositionMm"]},
            "measurements": {"diameterMm":None,"volumeMl":None},
            "model": {"id":model_id,"version":revision,"provider":"local"},
            "limitations": ["Unvalidated, uncalibrated original pretrained model output",
                            "2D research ROI; full native in-plane segmentation is not established",
                            "Physician review required; no hemorrhage exclusion permitted"]
        })
    return {
        "schema": "opus-evidence/v1", "modality":"CT",
        "coverage": "partially_assessed" if findings else "not_assessed",
        "seriesReviewed": [native[0]["seriesUid"]] if findings else [],
        "findings":findings,
        "warnings": [
            "Public research ICH inference only; not clinically validated or patient authorized",
            "Model absence of candidates does not exclude intracranial hemorrhage",
            f"Native source ROI unavailable for {unmappable} model candidates; these were not promoted",
            "Model/source weights and pixels remain outside GitHub and cloud"],
    }


def run_pipeline(args):
    if sys.platform != "linux":
        raise ValueError("requires_isolated_linux_research_worker_not_Mac_M1")
    if args.authorization != "PUBLIC-HEAD-NCCT-RESEARCH-OK":
        raise ValueError("explicit_public_ich_research_approval_required")
    if args.output_dir.exists() or args.output_dir.is_symlink() or not args.output_dir.parent.is_dir():
        raise ValueError("fresh_output_dir_with_existing_parent_required")
    converter = load_script("prepare-ich-public-dicom-hu.py", "opus_dicom_to_hu_ich")
    runner = load_script("run-ianpan-ich-research.py", "opus_real_ianpan_ich")
    # The converter verifies the source rights manifest and every source SHA.
    paths,_ = converter.authorize_series(args.dicom_dir,args.public_manifest)
    args.output_dir.mkdir(mode=0o700)
    try:
        nii = args.output_dir / "source-hu.nii"
        proof = args.output_dir / "source-hu-evidence.json"
        converted = converter.convert(args.dicom_dir,args.public_manifest,nii,proof)
        native = source_order(paths)
        if converted["conversionEvidence"]["originalDicomSliceCount"]!=len(native):
            raise ValueError("source_dicom_slices_changed")
        original = runner.run(argparse.Namespace(
            source=nii,manifest=proof,model_dir=args.model_dir,
            output=args.output_dir/"actual-original-model.json",device=args.device,
            download_pretrained=args.download_pretrained))
        result = bind_model_to_native_evidence(original,native,converted["sourceNiftiSha256"])
        evidence_path = args.output_dir/"private-native-evidence.json"
        evidence_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
        evidence_path.chmod(0o600)
        print(json.dumps({"status":"real_pretrained_ich_research_pipeline_completed",
                          "modelExecuted":True,"sourceBoundCandidates":len(result["findings"]),
                          "clinicalValidation":False,"patientMode":False}))
        return result
    except BaseException:
        shutil.rmtree(args.output_dir)
        raise


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-dir",required=True,type=Path)
    p.add_argument("--public-manifest",required=True,type=Path)
    p.add_argument("--model-dir",required=True,type=Path)
    p.add_argument("--output-dir",required=True,type=Path)
    p.add_argument("--device",choices=("cpu","cuda"),default="cpu")
    p.add_argument("--download-pretrained",action="store_true")
    p.add_argument("--authorization",required=True)
    run_pipeline(p.parse_args())


if __name__ == "__main__":
    main()
