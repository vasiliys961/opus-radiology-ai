#!/usr/bin/env python3
"""Build a genuine DICOM pixel-series *derived from* pinned public MSD lung_043 NIfTI.

This is NOT scanner-original DICOM. Fresh SOP UIDs demonstrate the application's
source-frame linkage only for this regenerated series; no original patient UIDs.
Input pixels are genuine publicly distributed CT HU and must round-trip exactly.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import nibabel as nib
import pydicom
from pydicom.dataset import FileDataset, FileMetaDataset
from pydicom.uid import CTImageStorage, ExplicitVRLittleEndian, generate_uid
from huggingface_hub import hf_hub_download
import importlib.util

CT_SHA="08b7aa88ee9946b0bf0a5fcd08af1d9b7720c4295e4f900a3e2f13d5c3b6b694"
REVISION="8788e7233406875cf5f2366cf27f8f155fb7a8cf"
def sha(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024),b""):
            h.update(chunk)
    return h.hexdigest()

def run(directory:Path,native:Path,manifest:Path):
    if directory.exists() or native.exists() or manifest.exists():
        raise ValueError("new_only_derived_dicom_outputs_required")
    original=Path(hf_hub_download(repo_id="MedOtter/msd-lung",repo_type="dataset",
        filename="imagesTr/lung_043.nii.gz",revision=REVISION,token=False))
    if sha(original)!=CT_SHA:
        raise ValueError("pinned_public_CT_SHA_mismatch")
    img=nib.load(str(original))
    a=np.asarray(img.affine,dtype=np.float64)
    dims=img.shape
    if len(dims)!=3 or dims[0]>512 or dims[1]>512 or not 8<=dims[2]<=300:
        raise ValueError("unsupported_real_CT_shape")
    # Store exact source voxels as signed 16-bit HU; never silently quantize.
    data=np.asarray(img.dataobj,dtype=np.float32)
    if not np.isfinite(data).all() or data.min() < -32768 or data.max() > 32767:
        raise ValueError("original_CT_not_representable_in_int16")
    rounded=np.rint(data)
    if np.max(np.abs(data-rounded))>0.001:
        raise ValueError("original_CT_not_integer_HU_cannot_reencode_losslessly")
    lps=a[:3,:3].copy()
    lps[:2,:]*=-1
    zero=a[:3,3].copy();zero[:2]*=-1
    col=lps[:,0];row=lps[:,1];through=lps[:,2]
    col_mm=float(np.linalg.norm(col));row_mm=float(np.linalg.norm(row))
    slice_mm=float(np.linalg.norm(through))
    if not (.1<col_mm<20 and .1<row_mm<20 and .1<slice_mm<20):
        raise ValueError("invalid_NIfTI_to_DICOM_spacing")
    x=col/col_mm;y=row/row_mm;normal=np.cross(x,y)
    side=float(np.dot(normal,through)/slice_mm)
    if abs(abs(side)-1)>0.0001 or abs(np.dot(x,y))>.0001:
        raise ValueError("oblique_nonorthogonal_NIfTI_not_supported")
    uid_study=generate_uid();uid_series=generate_uid();uid_frame=generate_uid()
    directory.mkdir(parents=True)
    sops=[]
    for z in range(dims[2]):
        sop=generate_uid()
        meta=FileMetaDataset()
        meta.MediaStorageSOPClassUID=CTImageStorage
        meta.MediaStorageSOPInstanceUID=sop
        meta.TransferSyntaxUID=ExplicitVRLittleEndian
        meta.ImplementationClassUID=generate_uid()
        path=directory/f"slice-{z:04d}.dcm"
        ds=FileDataset(str(path),{},file_meta=meta,preamble=b"\0"*128)
        ds.is_little_endian=True;ds.is_implicit_VR=False
        ds.SOPClassUID=CTImageStorage;ds.SOPInstanceUID=sop
        ds.StudyInstanceUID=uid_study
        ds.SeriesInstanceUID=uid_series
        ds.FrameOfReferenceUID=uid_frame
        ds.Modality="CT";ds.ImageType=["ORIGINAL","PRIMARY","AXIAL"]
        ds.BodyPartExamined="CHEST";ds.PatientIdentityRemoved="YES"
        ds.PatientName="";ds.PatientID=""
        ds.Rows=int(dims[1]);ds.Columns=int(dims[0])
        ds.ImageOrientationPatient=[str(float(v)) for v in np.r_[x,y]]
        position=zero+z*through
        ds.ImagePositionPatient=[str(float(v)) for v in position]
        ds.PixelSpacing=[str(row_mm),str(col_mm)]
        ds.SliceThickness=str(slice_mm);ds.InstanceNumber=z+1
        ds.SamplesPerPixel=1;ds.PhotometricInterpretation="MONOCHROME2"
        ds.BitsAllocated=16;ds.BitsStored=16;ds.HighBit=15
        ds.PixelRepresentation=1;ds.RescaleSlope="1";ds.RescaleIntercept="0";ds.RescaleType="HU"
        ds.PixelData=np.ascontiguousarray(rounded[:,:,z].T,dtype="<i2").tobytes()
        pydicom.dcmwrite(str(path),ds,enforce_file_format=True)
        sops.append(sop)
    spec=importlib.util.spec_from_file_location("ct_converter",
        Path(__file__).resolve().parents[1]/"services/imaging-ai/chest_dicom_to_monai.py")
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    proof=mod.convert_dicom_chest(directory,native,public_rights=True,deidentified=True)
    checked=nib.load(str(native))
    pixels=np.asarray(checked.dataobj,dtype=np.float32)
    reverse=side<0
    expect=rounded[:,:,::-1] if reverse else rounded
    if pixels.shape!=expect.shape or not np.array_equal(pixels,expect):
        raise ValueError("real_public_CT_DICOM_to_native_voxel_roundtrip_failed")
    # The converter's native z-axis follows the sorted ORIGINAL DICOM slices.
    native_sops=sops[::-1] if reverse else sops
    for z in (0,dims[2]//2,dims[2]-1):
        src_z=dims[2]-1-z if reverse else z
        expected_lps=zero+src_z*through
        actual=np.asarray(checked.affine[:3,3]+checked.affine[:3,2]*z)
        actual[:2]*=-1
        if np.linalg.norm(expected_lps-actual)>.06:
            raise ValueError("DICOM_NIfTI_origin_mismatch")
    # Never upload manifest to providers/artifacts: synthetic SOP IDs remain local.
    manifest.write_text(json.dumps({
        "schema":"opus-public-msd-reencoded-dicom/v1",
        "scannerOriginalDicom":False,"source":"MedOtter/msd-lung/lung_043",
        "sourceNiftiCompressedSha256":CT_SHA,
        "convertedNativeSha256":proof["sha256"],
        "derivedSopGeometryVerified":True,
        "scannerOriginalSopRegistrationVerified":False,
        "dimensions":list(dims),"nativeSopInstanceUids":native_sops,
        "sourceIntegerHuLossless":True,"publicStudyOnly":True,
    })+"\n")
    print("DERIVED REAL-PIXEL DICOM VERIFIED",json.dumps({
        "slices":dims[2],"nativeSHA":proof["sha256"],
        "actualPixelsNotSynthetic":True,"dicomScannerOriginal":False,
        "derivedSopGeometryVerified":True}),flush=True)
    return proof

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dicom-dir",type=Path,required=True)
    p.add_argument("--native",type=Path,required=True)
    p.add_argument("--manifest",type=Path,required=True)
    args=p.parse_args()
    run(args.dicom_dir,args.native,args.manifest)
if __name__=="__main__":
    main()
