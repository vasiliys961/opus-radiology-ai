#!/usr/bin/env python3
"""Convert a rights-cleared original MR FLAIR single DICOM series to native-grid NIfTI.

Research-only; no patient cloud upload or silent privacy declaration. Validates
slice geometry and intensity, emits a true complete NIfTI volume and optional
public-research admission. Refuses mixed, gapped, tilted or compressed series
without installed pixel decoders instead of fabricating voxels.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import numpy as np

MAX_SLICES=300
MAX_SIDE=512

def convert_mr_flair(folder:Path,output:Path):
    import pydicom
    folder=Path(folder);output=Path(output)
    if not folder.is_dir() or output.exists() or output.suffix!=".nii":
        raise ValueError("existing_source_directory_and_new_nii_output_required")
    paths=sorted(p for p in folder.iterdir() if p.is_file() and not p.is_symlink())
    if not 8<=len(paths)<=MAX_SLICES:
        raise ValueError("complete_single_series_8_to_300_slices_required")
    slices=[]
    for path in paths:
        ds=pydicom.dcmread(str(path),stop_before_pixels=False)
        if (str(getattr(ds,"Modality",""))!="MR" or
            getattr(ds,"NumberOfFrames",1)!=1 or
            int(ds.Rows)>MAX_SIDE or int(ds.Columns)>MAX_SIDE or
            int(ds.Rows)<8 or int(ds.Columns)<8 or
            int(getattr(ds,"SamplesPerPixel",0))!=1 or
            int(getattr(ds,"PixelRepresentation",-1)) not in (0,1) or
            int(getattr(ds,"BitsAllocated",0)) not in (8,16) ):
            raise ValueError("unsupported_original_mr_pixel_format")
        try:
            orientation=np.array([float(x) for x in ds.ImageOrientationPatient],dtype=float)
            ipp=np.array([float(x) for x in ds.ImagePositionPatient],dtype=float)
            spacing=np.array([float(x) for x in ds.PixelSpacing],dtype=float)
            slope=float(getattr(ds,"RescaleSlope",1.0));intercept=float(getattr(ds,"RescaleIntercept",0.0))
            uid=(str(ds.StudyInstanceUID),str(ds.SeriesInstanceUID),str(ds.FrameOfReferenceUID))
            sop=str(ds.SOPInstanceUID)
        except (AttributeError,ValueError,TypeError) as exc:
            raise ValueError("missing_mr_geometry") from exc
        if (not np.all(np.isfinite(orientation)) or not np.all(np.isfinite(ipp)) or
            not np.all(np.isfinite(spacing)) or not np.isfinite(slope) or
            not np.isfinite(intercept) or slope<=0 or
            np.any(spacing<0.1) or np.any(spacing>20)):
            raise ValueError("invalid_mr_geometry")
        row,col=orientation[:3],orientation[3:]
        normal=np.cross(row,col)
        if (abs(np.linalg.norm(row)-1)>1e-4 or
            abs(np.linalg.norm(col)-1)>1e-4 or
            abs(np.dot(row,col))>1e-4 or
            abs(np.linalg.norm(normal)-1)>1e-4):
            raise ValueError("invalid_dicom_direction_cosines")
        slices.append((ds,ipp,orientation,spacing,slope,intercept,uid,sop,path))
    first=slices[0];dims=(int(first[0].Columns),int(first[0].Rows),len(slices))
    for ds,ipp,o,ps,slope,intercept,uid,sop,path in slices:
        if (uid!=first[6] or ds.Rows!=dims[1] or ds.Columns!=dims[0] or
            np.max(abs(o-first[2]))>1e-4 or
            np.max(abs(ps-first[3]))>1e-4):
            raise ValueError("mixed_series_or_inconsistent_geometry")
    if len(set(x[7] for x in slices))!=len(slices):
        raise ValueError("duplicate_sop_instance")
    normal=np.cross(first[2][:3],first[2][3:])
    slices.sort(key=lambda x:float(np.dot(x[1],normal)))
    positions=np.array([x[1] for x in slices])
    increments=np.diff(positions,axis=0)
    step=np.median(increments,axis=0)
    dz=float(np.dot(step,normal))
    if (dz<0.1 or dz>20 or
        np.max(np.linalg.norm(increments-step,axis=1))>max(0.05,dz*0.01) or
        np.linalg.norm(step-normal*dz)>0.05):
        raise ValueError("gapped_nonuniform_or_tilted_mr_series")
    # NIfTI index axis 0 follows DICOM columns, axis 1 follows DICOM rows.
    lps=np.stack((first[2][:3]*first[3][1],first[2][3:]*first[3][0],step),axis=1)
    ras=lps.copy();ras[:2,:]*=-1
    origin=positions[0].copy();origin[:2]*=-1
    total=math.prod(dims)
    header=bytearray(352)
    struct.pack_into("<i",header,0,348)
    struct.pack_into("<8h",header,40,3,*dims,1,1,1,1)
    struct.pack_into("<hh",header,70,16,32)
    struct.pack_into("<8f",header,76,1,float(first[3][1]),float(first[3][0]),dz,1,1,1,1)
    struct.pack_into("<f",header,108,352.0)
    struct.pack_into("<ff",header,112,1.0,0.0)
    header[123]=2
    struct.pack_into("<hh",header,252,0,1)
    for r in range(3):
        struct.pack_into("<4f",header,280+16*r,*map(float,ras[r]),float(origin[r]))
    header[344:348]=b"n+1\\x00".replace(b"\\x00",b"\x00")
    # Write to a private temp file first; never leave partial accepted output.
    import os
    import tempfile
    fd,tmp=tempfile.mkstemp(prefix=".opus-mr-",suffix=".nii",dir=output.parent)
    try:
        with os.fdopen(fd,"wb") as dest:
            dest.write(header)
            for ds,*_ in slices:
                px=np.asarray(ds.pixel_array)
                if px.shape!=(dims[1],dims[0]):raise ValueError("unexpected_decoded_pixel_shape")
                hu=px.astype(np.float32)*float(getattr(ds,"RescaleSlope",1.0))+float(getattr(ds,"RescaleIntercept",0.0))
                if not np.all(np.isfinite(hu)):raise ValueError("nonfinite_original_mr_signal")
                dest.write(np.ascontiguousarray(hu,dtype="<f4").tobytes())
        if Path(tmp).stat().st_size!=352+total*4:raise ValueError("truncated_nifti_output")
        os.replace(tmp,output)
    finally:
        if Path(tmp).exists():Path(tmp).unlink()
    sha=hashlib.sha256()
    with output.open("rb") as stream:
        for part in iter(lambda:stream.read(1024*1024),b""):sha.update(part)
    return {"sha256":sha.hexdigest(),"dimensions":dims,
            "sliceSpacingMm":dz,"researchOnly":True,"sequenceCertifiedByOperator":False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--dicom-folder",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    print(json.dumps(convert_mr_flair(a.dicom_folder,a.output)))
if __name__=="__main__":main()
