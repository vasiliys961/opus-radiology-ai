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
    """Source planes including physical LPS geometry; do not infer k -> SOP UID."""
    import numpy as np
    import pydicom
    items = []
    for path in paths:
        ds = pydicom.dcmread(str(path), stop_before_pixels=True)
        row = np.asarray([float(v) for v in ds.ImageOrientationPatient[:3]], dtype=float)
        column = np.asarray([float(v) for v in ds.ImageOrientationPatient[3:]], dtype=float)
        normal = np.cross(row, column)
        position = np.asarray([float(v) for v in ds.ImagePositionPatient], dtype=float)
        spacing = [float(v) for v in ds.PixelSpacing]
        rows, columns = int(ds.Rows), int(ds.Columns)
        if (not all(np.isfinite(x).all() for x in (row,column,normal,position)) or
            abs(np.linalg.norm(row)-1)>0.001 or
            abs(np.linalg.norm(column)-1)>0.001 or
            abs(float(row @ column))>0.001 or
            not all(0.1 <= value <= 5 for value in spacing) or
            not (128 <= rows <= 512 and 128 <= columns <= 512)):
            raise ValueError("invalid_dicom_source_plane")
        items.append({
            "slicePositionMm":float(position @ normal),
            "seriesUid":str(ds.SeriesInstanceUID),
            "sopInstanceUid":str(ds.SOPInstanceUID),
            "imagePositionLpsMm":position.tolist(),
            "rowDirectionLps":row.tolist(),
            "columnDirectionLps":column.tolist(),
            "pixelSpacingMm":spacing,
            "rows":rows,"columns":columns,
        })
    items.sort(key=lambda x:x["slicePositionMm"])
    if (len(items)<8 or len(items)>64 or
        len({s["sopInstanceUid"] for s in items})!=len(items) or
        len({s["seriesUid"] for s in items})!=1 or
        any(abs(items[i+1]["slicePositionMm"]-items[i]["slicePositionMm"])<0.1
            for i in range(len(items)-1))):
        raise ValueError("invalid_source_dicom_identity_or_slice_order")
    return items


def resolve_source_plane(roi,native,affine_ras,source_dimensions_xyz):
    """Match native ROI to EXACT DICOM SOP using RAS→LPS plane geometry.

    The original DICOM order, acquisition direction and NIfTI k orientation
    must never be inferred from an array index. Require one unique plane and
    verify that ROI actually falls inside that DICOM image's physical FOV.
    """
    import numpy as np
    dims = source_dimensions_xyz
    if (not isinstance(dims,(list,tuple)) or len(dims)!=3 or
        any(type(v) is not int or v<8 or v>512 for v in dims) or
        len(native)!=dims[2]):
        raise ValueError("inconsistent_nifti_dicom_source_shape")
    affine = np.asarray(affine_ras,dtype=float)
    if (affine.shape!=(4,4) or not np.isfinite(affine).all() or
        not np.allclose(affine[3],[0,0,0,1],atol=1e-6) or
        abs(np.linalg.det(affine[:3,:3]))<1e-6):
        raise ValueError("invalid_source_nifti_ras_affine")
    bounds=roi.get("boundingBoxNativeNiftiXYZ")
    if (not isinstance(bounds,list) or len(bounds)!=6 or
        any(type(v) is not int for v in bounds) or
        any(bounds[i]<0 or bounds[i]>bounds[i+3] or bounds[i+3]>=dims[i]
            for i in range(3)) or bounds[2]!=bounds[5]):
        raise ValueError("unverified_single_source_slice_ich_roi")
    x0,y0,k,x1,y1,_ = bounds
    voxel = np.asarray([[x,y,k,1.] for x in (x0,x1) for y in (y0,y1)],dtype=float)
    world_ras=(affine @ voxel.T).T[:,:3]
    world_box=roi.get("boundingBoxWorldRasMm")
    expected=np.r_[world_ras.min(axis=0),world_ras.max(axis=0)]
    if (not isinstance(world_box,list) or len(world_box)!=6 or
        not np.isfinite(np.asarray(world_box,dtype=float)).all() or
        not np.allclose(world_box,expected,atol=.05,rtol=0)):
        raise ValueError("model_world_roi_disagrees_with_original_nifti_affine")
    world_lps=world_ras*np.asarray([-1.,-1.,1.])
    matches=[]
    for plane in native:
        position=np.asarray(plane["imagePositionLpsMm"],dtype=float)
        row=np.asarray(plane["rowDirectionLps"],dtype=float)
        col=np.asarray(plane["columnDirectionLps"],dtype=float)
        spacing=np.asarray(plane["pixelSpacingMm"],dtype=float)
        if (position.shape!=(3,) or row.shape!=(3,) or col.shape!=(3,) or spacing.shape!=(2,) or
            not all(np.isfinite(v).all() for v in (position,row,col,spacing)) or
            np.any(spacing<=0)):
            raise ValueError("invalid_source_dicom_plane_metadata")
        normal=np.cross(row,col)
        displacement=world_lps-position
        distance=np.abs(displacement @ normal)
        if float(np.max(distance))>.05:
            continue
        xx=(displacement @ row)/spacing[1]  # columns
        yy=(displacement @ col)/spacing[0]  # rows
        if (float(np.min(xx))>=-.25 and float(np.max(xx))<=plane["columns"]-1+.25 and
            float(np.min(yy))>=-.25 and float(np.max(yy))<=plane["rows"]-1+.25):
            matches.append(plane)
    if len(matches)!=1:
        raise ValueError("roi_does_not_match_one_exact_original_dicom_plane")
    return matches[0]


def bind_model_to_native_evidence(report, native, source_sha, affine_ras, source_dimensions_xyz,
                                  model_id="ianpan/ct-head-hemorrhage-detection"):
    """Local projection of a genuine model result. No masks or fake normal findings."""
    if (not isinstance(report,dict) or report.get("schema")!="opus-ianpan-genuine-public-ich-research/v1" or
        report.get("status")!="genuine_pretrained_inference_requires_independent_validation" or
        report.get("model",{}).get("id")!=model_id or
        report.get("model",{}).get("checkpointSha256Verified") is not True or
        report.get("source",{}).get("niftiSha256")!=source_sha or
        report.get("source",{}).get("sourceOriginalDicomHURescaleIndependentlyVerified") is not True or
        report.get("source",{}).get("modelOrderedSliceCount")!=len(native) or
        report.get("source",{}).get("sourceDimensionsXYZ")!=list(source_dimensions_xyz) or
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
        slice_ = resolve_source_plane(roi,native,affine_ras,source_dimensions_xyz)
        score = item.get("rawUncalibratedScore")
        if type(score) not in (int,float) or not 0<=score<=1:
            raise ValueError("invalid_original_ich_score")
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
        # Re-check every original source DICOM byte before reporting source UIDs.
        converter.authorize_series(args.dicom_dir,args.public_manifest)
        if converted["conversionEvidence"]["originalDicomSliceCount"]!=len(native):
            raise ValueError("source_dicom_slices_changed")
        original = runner.run(argparse.Namespace(
            source=nii,manifest=proof,model_dir=args.model_dir,
            output=args.output_dir/"actual-original-model.json",device=args.device,
            download_pretrained=args.download_pretrained))
        # Fail if the model runner or another process modified the verified HU source.
        if converter.file_sha(nii)!=converted["sourceNiftiSha256"]:
            raise ValueError("source_nifti_changed_during_inference")
        converter.authorize_series(args.dicom_dir,args.public_manifest)
        import nibabel as nib
        image=nib.load(str(nii))
        result = bind_model_to_native_evidence(
            original,native,converted["sourceNiftiSha256"],
            image.affine,list(image.shape))
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
