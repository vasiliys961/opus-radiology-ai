#!/usr/bin/env python3
"""Research-only original CT liver/spleen attenuation: NOT a steatosis diagnosis.

The liver and spleen source-aligned binary masks must be supplied by a
separately verified real pretrained anatomical segmentator. This module does
not claim the anatomy checkpoint or any disease-specific model was run.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys

import numpy as np

MAX_NIFTI_BYTES = 850 * 1024**2
MAX_VOXELS = 512 * 512 * 350
MASK_MIN_VOXELS = 100
SCHEMA = "opus-ncct-liver-spleen-attenuation-candidates/v1"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for part in iter(lambda: f.read(1024 * 1024), b""):
            h.update(part)
    return h.hexdigest()


def inspect(ct_path: Path, liver_path: Path, spleen_path: Path) -> dict:
    import nibabel as nib
    from scipy import ndimage

    paths = (ct_path, liver_path, spleen_path)
    if len({p.resolve(strict=True) for p in paths}) != 3:
        raise ValueError("original_CT_liver_spleen_must_be_distinct_files")
    for path in paths:
        if (path.is_symlink() or not path.is_file()
                or not 256 <= path.stat().st_size <= MAX_NIFTI_BYTES
                or not path.name.endswith((".nii", ".nii.gz"))):
            raise ValueError("source_or_mask_unavailable_or_unbounded")
    ct, liver, spleen = (nib.load(str(path)) for path in paths)
    if (ct.ndim != 3 or min(ct.shape) < 16 or int(np.prod(ct.shape)) > MAX_VOXELS
            or not np.isfinite(ct.affine).all()
            or abs(float(np.linalg.det(ct.affine[:3, :3]))) < 1e-7
            or not np.allclose(ct.affine[3], [0, 0, 0, 1])
            or ct.header.get_xyzt_units()[0] != "mm"):
        raise ValueError("original_CT_requires_bounded_3D_source_grid_and_mm")
    physical = np.linalg.norm(ct.affine[:3, :3], axis=0)
    if np.any(physical < .35) or np.any(physical > 5.01):
        raise ValueError("unsupported_CT_voxel_spacing_for_attenuation")
    for img in (liver, spleen):
        if (img.ndim != 3 or img.shape != ct.shape
                or not np.isfinite(img.affine).all()
                or img.header.get_xyzt_units()[0] != "mm"
                or not np.allclose(img.affine, ct.affine, atol=1e-3, rtol=0)
                or img.header.get_data_dtype().kind not in "biu"):
            raise ValueError("anatomical_segmentation_not_in_source_CT_physical_grid")
    m_liver = np.asanyarray(liver.dataobj)
    m_spleen = np.asanyarray(spleen.dataobj)
    if (not np.isin(m_liver, (0,1)).all() or
            not np.isin(m_spleen, (0,1)).all()):
        raise ValueError("two_original_organ_masks_must_be_binary")
    m_liver, m_spleen = m_liver.astype(bool), m_spleen.astype(bool)
    if np.any(m_liver & m_spleen):
        raise ValueError("liver_and_spleen_anatomical_masks_overlap")
    vox_ml = abs(float(np.linalg.det(ct.affine[:3, :3]))) / 1000.0
    organ_volumes = [int(np.count_nonzero(m))*vox_ml for m in (m_liver,m_spleen)]
    if not (500 <= organ_volumes[0] <= 5000 and 60 <= organ_volumes[1] <= 2500):
        raise ValueError("partial_or_implausible_liver_spleen_organ_volumes")
    # Two-voxel native erosion reduces edge/adjacent organ contamination.
    # This is morphological sampling, NOT a trained steatosis segmentation.
    sample_masks = [ndimage.binary_erosion(m,iterations=2) for m in (m_liver,m_spleen)]
    for name, mask in zip(("liver","spleen"),sample_masks):
        if np.count_nonzero(mask) < MASK_MIN_VOXELS:
            raise ValueError(name + "_insufficient_eroded_parenchymal_ROI")
    hu = np.asanyarray(ct.dataobj)
    values = []
    for name, mask in zip(("liver","spleen"),sample_masks):
        roi = np.asarray(hu[mask],dtype=np.float32)
        if not np.isfinite(roi).all():
            raise ValueError(name + "_nonfinite_original_CT_HU")
        if np.min(roi) < -300 or np.max(roi) > 2500:
            raise ValueError(name + "_unverified_HU_or_anatomy_contamination")
        lo, hi = np.percentile(roi,[10,90])
        trimmed = roi[(roi >= lo)&(roi <= hi)]
        if trimmed.size < MASK_MIN_VOXELS:
            raise ValueError(name + "_insufficient_trimmed_parenchymal_ROI")
        values.append({
            "anatomy":name,
            "wholeSegmentedAnatomyVolumeMl":round(organ_volumes[len(values)],3),
            "erodedSourceVoxels":int(np.count_nonzero(mask)),
            "trimmedVoxelCount":int(trimmed.size),
            "medianHU":round(float(np.median(trimmed)),3),
            "meanHU":round(float(np.mean(trimmed,dtype=np.float64)),3),
            "interquartileRangeHU":[round(float(v),3) for v in np.percentile(trimmed,[25,75])],
        })
    l,s=(v["medianHU"] for v in values)
    return {
        "sourceCtSha256":sha256(ct_path),
        "originalLiverMaskSha256":sha256(liver_path),
        "originalSpleenMaskSha256":sha256(spleen_path),
        "sourceShape":list(ct.shape),
        "sourcePhysicalVoxelsMm":[round(float(v),4) for v in physical],
        "sourceAffineRasMm":ct.affine.round(6).tolist(),
        "liverAndSpleenVoxelAndPhysicalGridMatched":True,
        "sampling":"two native binary erosions, then 10%-90% HU trimming separately",
        "organs":values,
        "liverMinusSpleenMedianHU":round(l-s,3),
        "liverToSpleenMedianHURatio":round(l/s,5) if abs(s)>5 else None,
        "zeroHUOutsideOrgansDoesNotEstablishCalibration":True,
        "radiologistReviewRequired":True,
        "notASteatosisDiagnosis":True,
        "noHistologyOrMRI_PDFFReference":True,
        "noValidatedDiagnosticSensitivity":True,
    }


def main():
    p = argparse.ArgumentParser(description=__doc__)
    for key in ("ct","liver-mask","spleen-mask","output"):
        p.add_argument("--"+key,required=True,type=Path)
    p.add_argument("--public-source-url",required=True)
    p.add_argument("--public-source-license",required=True)
    p.add_argument("--native-noncontrast-acquisition-reviewed",action="store_true")
    p.add_argument("--hu-rescale-calibration-reviewed",action="store_true")
    a = p.parse_args()
    if (not a.native_noncontrast_acquisition_reviewed
            or not a.hu_rescale_calibration_reviewed
            or not a.public_source_url.startswith("https://")
            or not a.public_source_license.strip()
            or len(a.public_source_url)>1000):
        p.error("authorized_public_noncontrast_original_CT_and_HU_review_required")
    if sys.platform != "linux":
        p.error("research analysis limited to isolated Linux host; no 8GB Mac run")
    out=a.output.expanduser().resolve()
    if (out.exists() or out.suffix!=".json" or not out.parent.is_dir()
            or any(out==q.expanduser().resolve() for q in (a.ct,a.liver_mask,a.spleen_mask))):
        p.error("new_separate_numeric_report_path_required")
    try:
        finding=inspect(a.ct.expanduser().resolve(strict=True),
                        a.liver_mask.expanduser().resolve(strict=True),
                        a.spleen_mask.expanduser().resolve(strict=True))
    except (OSError,ValueError,ImportError) as e:
        print("Source-native liver/spleen NCCT research rejected: "+str(e),file=sys.stderr)
        return 1
    report={
        "schema":SCHEMA,
        "target":"fatty_liver_quantitative_attenuation_research_marker_not_diagnosis",
        "sourceResearchURL":a.public_source_url,
        "sourceRightsOperatorAttested":a.public_source_license,
        "operatorAttestedOriginalNCCTNotIndependentlyDICOMVerified":True,
        "operatorAttestedHURescaleNotIndependentlyDICOMVerified":True,
        "anatomyFromPretrainedSegmentationClaimNotIndependentlyVerified":True,
        "pathologySpecificTrainedSteatosisDetector":False,
        "sourceExpertPositiveSteatosisVerified":False,
        "originalModelForwardCompletedByThisAdapter":False,
        "independentValidation":False,
        "patientUseAllowed":False,
        **finding,
    }
    out.write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps({"sourceCtSha256":report["sourceCtSha256"],
        "liverMinusSpleenMedianHU":report["liverMinusSpleenMedianHU"],
        "researchOnly":True,"patientUseAllowed":False}))
    return 0


if __name__=="__main__":
    raise SystemExit(main())
