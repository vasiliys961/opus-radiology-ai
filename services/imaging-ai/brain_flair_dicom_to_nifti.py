#!/usr/bin/env python3
"""Convert native single-series brain FLAIR DICOM to original-intensity NIfTI.

No resampling, normalization, cloud transfer, or automatic inference. The protocol
must be independently verified by the operator; TR/TE/TI alone cannot prove FLAIR.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import numpy as np

def convert_flair(folder: Path, output: Path, *, protocol_confirmed: bool):
    import pydicom
    import nibabel as nib
    folder, output = Path(folder), Path(output)
    if not protocol_confirmed:
        raise ValueError("FLAIR_protocol_must_be_independently_confirmed")
    if not folder.is_dir() or output.exists() or output.suffix not in (".nii", ".gz"):
        raise ValueError("source_folder_and_fresh_nifti_output_required")
    paths = sorted(p for p in folder.iterdir() if p.is_file() and not p.is_symlink())
    if not 8 <= len(paths) <= 512:
        raise ValueError("single_complete_8_to_512_slice_series_required")
    frames = []
    for path in paths:
        ds = pydicom.dcmread(str(path))
        if (str(getattr(ds, "Modality", "")) != "MR"
            or int(getattr(ds, "NumberOfFrames", 1)) != 1
            or int(getattr(ds, "SamplesPerPixel", 0)) != 1
            or int(getattr(ds, "BitsAllocated", 0)) not in (8,16)
            or int(ds.Rows) > 512 or int(ds.Columns) > 512):
            raise ValueError("unsupported_mr_pixel_or_multiframe")
        if "DERIVED" in getattr(ds, "ImageType", []) or "LOCALIZER" in getattr(ds, "ImageType", []):
            raise ValueError("derived_or_localizer_MRI_not_allowed")
        try:
            orient = np.asarray(ds.ImageOrientationPatient, dtype=float)
            ipp = np.asarray(ds.ImagePositionPatient, dtype=float)
            spacing = np.asarray(ds.PixelSpacing, dtype=float)
            uid = (str(ds.StudyInstanceUID), str(ds.SeriesInstanceUID), str(ds.FrameOfReferenceUID))
            sop = str(ds.SOPInstanceUID)
            slope = float(getattr(ds, "RescaleSlope", 1))
            intercept = float(getattr(ds, "RescaleIntercept", 0))
        except (AttributeError, TypeError, ValueError) as exc:
            raise ValueError("missing_mr_geometry_or_identity") from exc
        row, col = orient[:3], orient[3:]
        norm = np.cross(row, col)
        if (orient.shape != (6,) or ipp.shape != (3,) or spacing.shape != (2,)
            or not np.isfinite(orient).all() or not np.isfinite(ipp).all()
            or not np.isfinite(spacing).all()
            or np.any(spacing < 0.1) or np.any(spacing > 5)
            or abs(np.linalg.norm(row)-1)>1e-3
            or abs(np.linalg.norm(col)-1)>1e-3
            or abs(np.dot(row,col))>1e-3
            or not np.isfinite([slope,intercept]).all() or slope <= 0):
            raise ValueError("invalid_mr_geometry_or_scaling")
        frames.append((ds, ipp, orient, spacing, uid, sop, slope, intercept))
    first = frames[0]
    if len({x[5] for x in frames}) != len(frames):
        raise ValueError("duplicate_mr_sop")
    for ds,ipp,ori,sp,uid,*_ in frames:
        if (uid != first[4] or ds.Rows != first[0].Rows or ds.Columns != first[0].Columns
            or np.max(abs(ori-first[2]))>1e-3 or np.max(abs(sp-first[3]))>1e-3):
            raise ValueError("mixed_mr_series_or_inconsistent_geometry")
    normal = np.cross(first[2][:3], first[2][3:])
    frames.sort(key=lambda x: float(np.dot(x[1],normal)))
    positions = np.stack([x[1] for x in frames])
    steps = np.diff(positions,axis=0)
    step = np.median(steps,axis=0)
    dz = float(np.dot(step,normal))
    if (not 0.3 <= dz <= 5.0
        or np.max(np.linalg.norm(steps-step,axis=1))>max(0.05,dz*0.02)
        or np.linalg.norm(step-normal*dz)>0.05):
        raise ValueError("gapped_irregular_or_tilted_mr_series")
    # DICOM column index follows first IOP vector; row index follows second.
    lps = np.column_stack((first[2][:3]*first[3][1],
                           first[2][3:]*first[3][0],step))
    ras = lps.copy(); ras[:2,:] *= -1
    origin = positions[0].copy();origin[:2] *= -1
    affine = np.eye(4);affine[:3,:3] = ras;affine[:3,3] = origin
    dimensions = (int(first[0].Columns), int(first[0].Rows), len(frames))
    if np.prod(dimensions, dtype=np.int64) > 80_000_000:
        raise ValueError("MRI_volume_exceeds_WMH_CPU_limit")
    data = np.empty(dimensions, dtype=np.float32)
    for k,(ds,*_,slope,intercept) in enumerate(frames):
        pixels = np.asarray(ds.pixel_array)
        if pixels.shape != (dimensions[1], dimensions[0]):
            raise ValueError("decoded_mr_pixel_shape_mismatch")
        data[:,:,k] = (pixels.astype(np.float32)*slope+intercept).T
    if not np.isfinite(data).all():
        raise ValueError("nonfinite_mr_intensity")
    img = nib.Nifti1Image(data,affine)
    img.set_sform(affine, code=1);img.set_qform(affine, code=1)
    fd, temp = tempfile.mkstemp(prefix=".opus-flair-", suffix=".nii.gz",dir=output.parent)
    os.close(fd)
    try:
        nib.save(img,temp)
        os.replace(temp,output)
    finally:
        if os.path.exists(temp): os.unlink(temp)
    sha=hashlib.sha256()
    with output.open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):sha.update(block)
    return {"sourceFLAIRSHA256":sha.hexdigest(),"dimensions":dimensions,
            "sliceSpacingMm":dz,"sourceSOPInstanceUIDs":[x[5] for x in frames],
            "sourceDicomSHA256":[hashlib.sha256(Path(x[0].filename).read_bytes()).hexdigest() for x in frames],
            "protocolConfirmedByOperator":True,"nativeGeometryPreserved":True,
            "researchOnly":True,"modelInferenceCompleted":False}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dicom-folder",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--flair-protocol-confirmed",action="store_true")
    args=parser.parse_args()
    print(json.dumps(convert_flair(args.dicom_folder,args.output,
                                   protocol_confirmed=args.flair_protocol_confirmed)))
if __name__=="__main__": main()
