#!/usr/bin/env python3
"""Render real sampled CT PNGs from EXACT DICOM slices of the fresh CLN source.

Local mapping uses generated, derived DICOM SOP identifiers. SOP IDs, image hashes,
and source voxel coordinates remain on runner, never in Gemini/Opus prompts.
"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import nibabel as nib
import pydicom
from PIL import Image
def sha(p):
    h=hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda:f.read(1048576),b""):
            h.update(b)
    return h.hexdigest()
def run(dicom_dir,native,manifest,worker,folder):
    metadata=json.loads(manifest.read_text())
    evidence=json.loads(worker.read_text())
    if (metadata.get("schema")!="opus-public-msd-reencoded-dicom/v1" or
        evidence.get("schema")!="opus-original-cln-private-http-positive-public-ct/v1" or
        evidence.get("realOriginalModelForwardCompleted") is not True or
        evidence.get("derivedDicomSopRegistrationVerified") is not True or
        metadata.get("scannerOriginalDicom") is not False or
        metadata.get("derivedSopGeometryVerified") is not True or
        evidence.get("sourceSha256UploadedNative") != sha(native) or
        metadata.get("convertedNativeSha256") != sha(native) or
        evidence.get("candidateCount") != len(evidence.get("candidates",[])) or
        not evidence["candidates"] or evidence["candidateCount"]>10):
        raise ValueError("CLN_DICOM_source_or_fresh_original_forward_not_bound")
    source=nib.load(str(native))
    if list(source.shape)!=metadata["dimensions"]:
        raise ValueError("source_dimensions_changed")
    native_sops=metadata["nativeSopInstanceUids"]
    by_sop={}
    for path in dicom_dir.glob("*.dcm"):
        ds=pydicom.dcmread(str(path),stop_before_pixels=False)
        sop=str(ds.SOPInstanceUID)
        if sop in by_sop:
            raise ValueError("duplicate_DICOM_SOP")
        by_sop[sop]=ds
    if len(native_sops)!=len(by_sop) or set(native_sops)!=set(by_sop):
        raise ValueError("DICOM_SOP_set_changed_after_original_forward")
    center=evidence["candidates"][0]["sourceVoxelCentroidIJK"]
    z=int(round(center[2]))
    indices=[min(max(z+delta,0),source.shape[2]-1) for delta in (-6,-2,0,4)]
    if len(set(indices))!=4:
        raise ValueError("sampled_lesion_slices_not_distinct")
    folder.mkdir(parents=True,exist_ok=False)
    for i,k in enumerate(indices,1):
        # Decode the actual pydicom pixel bytes, NOT the source NIfTI raster.
        ds=by_sop[native_sops[k]]
        if ds.RescaleType!="HU" or ds.Modality!="CT":
            raise ValueError("not_genuine_CT_HU_DICOM")
        image=ds.pixel_array.astype(np.float32)*float(ds.RescaleSlope)+float(ds.RescaleIntercept)
        plane=image.T
        source_plane=np.asarray(source.dataobj[:,:,k],dtype=np.float32)
        if not np.array_equal(plane,source_plane):
            raise ValueError("DICOM_pixels_not_same_CLN_source_native_slice")
        window=(np.clip(plane,-1000,400)+1000)*(255/1400)
        pixels=np.uint8(np.rint(window))
        Image.fromarray(np.flipud(pixels.T)).convert("RGB").save(
            folder/f"frame-{i}.png",optimize=True)
    mapping={
        "sourceImageSha256":evidence["sourceSha256UploadedNative"],
        "detectorSourceImageSha256":sha(native),
        "imageDimensions":list(source.shape),
        "reviewedFrames":[{"frameId":f"frame-{i}","sourceAxialIndex":k}
                          for i,k in enumerate(indices,1)],
        # Internal proof only: identities MUST NOT reach model prompts/artifacts.
        "derivedDicomSopRegistrationVerified":True,
        "originalDicomSopRegistrationVerified":False,
        "scannerOriginalDicom":False,
        "localSopBinding":[{"imageId":f"frame-{i}","sop":native_sops[k]}
                           for i,k in enumerate(indices,1)],
    }
    (folder/"frame-relative-map.json").write_text(json.dumps(mapping)+"\n")
    print("FRESH DICOM CT -> VERIFIED CLN CANDIDATES -> 4 REAL DICOM PNG",
          json.dumps({"completedForward":True,"candidateCount":evidence["candidateCount"],
              "verifiedDerivedDicomSopBinding":True,
              "originalScannerSopAvailable":False,"frames":4}),flush=True)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("dicom-dir","native","manifest","worker","folder"):
        p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args()
    run(a.dicom_dir,a.native,a.manifest,a.worker,a.folder)
