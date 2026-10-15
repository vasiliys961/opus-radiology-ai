#!/usr/bin/env python3
"""Convert one approved public axial NCCT DICOM series to a HU NIfTI.

This is NOT deidentification, license approval, independent diagnosis, or a
clinically validated reformat. Refuses mixed series, missing rescale values,
obliquity, duplicate/irregular geometry and source-integrity mismatches.
No raw CT, patient tags, identifiers or filenames are printed/uploaded.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re

MAX_FILES = 64
MAX_TOTAL_BYTES = 128 * 1024**2
FILE_RE = re.compile(r"^[a-zA-Z0-9_.-]{1,160}\.dcm$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")

def file_sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()

def authorize_series(folder: Path, authorization: Path) -> tuple[list[Path], dict]:
    if folder.is_symlink() or not folder.is_dir() or authorization.is_symlink() or not authorization.is_file():
        raise ValueError("source_or_authorization_not_regular")
    if authorization.stat().st_size > 16384:
        raise ValueError("authorization_oversized")
    proof = json.loads(authorization.read_text(encoding="utf-8"))
    if not isinstance(proof, dict) or any((
        proof.get("schema") != "opus-public-dicom-head-ncct-authorization/v1",
        proof.get("publicDataRightsReviewed") is not True,
        proof.get("deidentifiedPublicDataset") is not True,
        proof.get("modality") != "CT",
        proof.get("anatomy") != "HEAD",
        proof.get("contrast") != "NONCONTRAST",
        proof.get("sourceFullStudy") is not True,
        proof.get("consent") != "PUBLIC-HEAD-NCCT-RESEARCH-OK",
    )):
        raise ValueError("public_rights_or_noncontrast_unverified")
    files = proof.get("dicomFiles")
    if not isinstance(files, list) or not 8 <= len(files) <= MAX_FILES:
        raise ValueError("invalid_public_source_count")
    found = []
    seen = set()
    total = 0
    for item in files:
        if not isinstance(item, dict) or set(item) != {"name", "sha256"}:
            raise ValueError("invalid_source_item")
        name, digest = item["name"], item["sha256"]
        if (not isinstance(name,str) or not FILE_RE.fullmatch(name) or name in seen
            or not isinstance(digest,str) or not SHA_RE.fullmatch(digest)):
            raise ValueError("invalid_public_dicom_identity")
        seen.add(name)
        f = folder/name
        if f.is_symlink() or not f.is_file():
            raise ValueError("missing_or_linked_public_dicom")
        total += f.stat().st_size
        if total > MAX_TOTAL_BYTES or not 128 <= f.stat().st_size <= 16*1024**2:
            raise ValueError("public_dicom_bytes_exceed_limit")
        if file_sha(f) != digest:
            raise ValueError("public_dicom_sha_mismatch")
        found.append(f)
    if set(p.name for p in folder.iterdir()) != seen:
        raise ValueError("folder_has_unreviewed_files")
    return found, proof

def _numbers(v,n,label):
    try:
        values = [float(x) for x in v]
    except (TypeError,ValueError) as exc:
        raise ValueError("missing_or_invalid_"+label) from exc
    if len(values)!=n or any(not math.isfinite(x) for x in values):
        raise ValueError("invalid_"+label)
    return values

def read_and_verify_dicom(files: list[Path]):
    import numpy as np
    import pydicom
    records = []
    seen_sop = set()
    series_uid = study_uid = prior = None
    for f in files:
        ds = pydicom.dcmread(str(f),force=False)
        if (ds.get("Modality")!="CT" or int(ds.get("SamplesPerPixel",0))!=1
            or int(ds.get("NumberOfFrames",1))!=1):
            raise ValueError("not_single_frame_ct")
        if ds.get("PhotometricInterpretation") not in ("MONOCHROME1","MONOCHROME2"):
            raise ValueError("unsupported_monochrome")
        if any("LOCALIZER" in str(x).upper() or "SCOUT" in str(x).upper()
               for x in ds.get("ImageType",[])):
            raise ValueError("localizer_not_a_diagnostic_slice")
        uid = str(ds.get("SeriesInstanceUID",""))
        study = str(ds.get("StudyInstanceUID",""))
        sop = str(ds.get("SOPInstanceUID",""))
        if not uid or not study or not sop or sop in seen_sop:
            raise ValueError("missing_or_duplicate_source_uid")
        if series_uid is None:
            series_uid,study_uid = uid,study
        if uid!=series_uid or study!=study_uid:
            raise ValueError("mixed_dicom_study_or_series")
        seen_sop.add(sop)
        rows,cols = int(ds.get("Rows",0)),int(ds.get("Columns",0))
        if not(128<=rows<=512 and 128<=cols<=512):
            raise ValueError("unsupported_ct_matrix")
        iop = _numbers(ds.get("ImageOrientationPatient"),6,"orientation")
        ipp = _numbers(ds.get("ImagePositionPatient"),3,"position")
        spacing = _numbers(ds.get("PixelSpacing"),2,"pixel_spacing")
        slope = float(ds.get("RescaleSlope",float("nan")))
        intercept = float(ds.get("RescaleIntercept",float("nan")))
        if (not math.isfinite(slope) or slope<=0 or not math.isfinite(intercept)
            or any(not 0.1<=v<=5 for v in spacing)):
            raise ValueError("missing_hu_rescale_or_spacing")
        row = np.array(iop[:3],float)
        col = np.array(iop[3:],float)
        normal = np.cross(row,col)
        if (abs(np.linalg.norm(normal)-1)>1e-3 or abs(float(normal[2]))<0.99
            or abs(float(row[2]))>0.02 or abs(float(col[2]))>0.02):
            raise ValueError("nonaxial_or_invalid_dicom_orientation")
        if prior is None:
            prior = (rows,cols,iop,spacing)
        else:
            if ((rows,cols)!=prior[:2] or
                not np.allclose(iop,prior[2],atol=1e-4) or
                not np.allclose(spacing,prior[3],atol=1e-4)):
                raise ValueError("inconsistent_dicom_geometry")
        try:
            pixels = np.asarray(ds.pixel_array,dtype=np.float32)
        except Exception as exc:
            raise ValueError("unsupported_dicom_pixel_encoding") from exc
        if pixels.shape!=(rows,cols):
            raise ValueError("inconsistent_pixel_matrix")
        hu = pixels*slope+intercept
        if not np.isfinite(hu).all():
            raise ValueError("invalid_ct_hu")
        position = float(np.dot(np.array(ipp,float),normal))
        records.append((position,ipp,hu))
    records.sort(key=lambda x:x[0])
    increments = np.diff([r[0] for r in records])
    if (len(increments)<1 or np.any(increments<0.1) or np.any(increments>12)
        or np.any(np.abs(increments-np.median(increments))>0.15)):
        raise ValueError("inconsistent_or_duplicate_slice_positions")
    positions_3d = np.array([r[1] for r in records],float)
    step = np.mean(np.diff(positions_3d,axis=0),axis=0)
    if not np.allclose(np.diff(positions_3d,axis=0),step,atol=0.2):
        raise ValueError("moving_or_tilted_ct_slice_origin")
    first = records[0][1]
    # NIfTI voxels x=original DICOM column, y=row, z=ordered physical slice.
    lps = np.eye(4,dtype=float)
    lps[:3,0] = np.array(prior[2][:3])*prior[3][1]
    lps[:3,1] = np.array(prior[2][3:])*prior[3][0]
    lps[:3,2] = step
    lps[:3,3] = first
    ras = np.diag([-1.,-1.,1.,1.]) @ lps
    data = np.stack([r[2].T for r in records],axis=-1).astype(np.float32)
    # Plausible HU dynamic range does not independently prove HU provenance.
    if float(data.min()) < -4096 or float(data.max()) > 6000 or float(data.max()-data.min())<100:
        raise ValueError("non_hu_like_ct_intensities")
    return data,ras,{
        "dimensions":list(data.shape),"sliceCount":len(records),
        "minHu":round(float(data.min()),1),"maxHu":round(float(data.max()),1),
        "medianSliceStepMm":round(float(np.median(increments)),4),
    }

def np_allclose(a,b):
    import numpy as np
    return bool(np.allclose(a,b,rtol=1e-5,atol=1e-3))

def convert(folder:Path,authorization:Path,output:Path,manifest:Path)->dict:
    if (output.suffix!=".nii" or manifest.suffix!=".json" or output.exists()
        or manifest.exists() or output==manifest):
        raise ValueError("new_nii_and_json_outputs_required")
    paths,proof=authorize_series(folder,authorization)
    data,affine,evidence=read_and_verify_dicom(paths)
    import nibabel as nib
    output.parent.mkdir(parents=True,exist_ok=True)
    manifest.parent.mkdir(parents=True,exist_ok=True)
    try:
        image=nib.Nifti1Image(data,affine)
        image.set_sform(affine,code=1)
        image.set_qform(affine,code=0)
        image.header.set_xyzt_units("mm")
        nib.save(image,str(output))
        opened=nib.load(str(output))
        if not np_allclose(opened.affine,affine) or not np_allclose(opened.dataobj,data):
            raise ValueError("written_nifti_does_not_preserve_hu_or_geometry")
        result={
            "schema":"opus-public-head-ct-hu-evidence/v1",
            "modality":"CT","anatomy":"HEAD","contrast":"NONCONTRAST",
            "publicDataRightsReviewed":proof["publicDataRightsReviewed"],
            "deidentifiedPublicDataset":proof["deidentifiedPublicDataset"],
            "sourceUnits":"HU_FROM_VERIFIED_DICOM_RESCALE",
            "sourceFullStudy":proof["sourceFullStudy"],
            "consent":proof["consent"],
            "sourceNiftiSha256":file_sha(output),
            "conversionEvidence":{
                "kind":"strict_source_dicom_to_hu_nifti",
                "originalDicomSliceCount":len(paths),
                "originalSourceManifestSha256":file_sha(authorization),
                **evidence,
                "patientIdentifiersExported":False,
                "independentPrivacyAuditCompleted":False,
                "clinicallyValidated":False,
            },
        }
        manifest.write_text(json.dumps(result,indent=2,ensure_ascii=False))
    except BaseException:
        output.unlink(missing_ok=True)
        manifest.unlink(missing_ok=True)
        raise
    print(json.dumps({"status":"research_hu_nifti_ready","sliceCount":len(paths),
                      "clinicalValidation":False,"independentPrivacyAudit":False}))
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-dir",type=Path,required=True)
    p.add_argument("--public-authorization",type=Path,required=True)
    p.add_argument("--output-nii",type=Path,required=True)
    p.add_argument("--output-manifest",type=Path,required=True)
    args=p.parse_args()
    convert(args.dicom_dir,args.public_authorization,args.output_nii,args.output_manifest)

if __name__=="__main__":
    main()
