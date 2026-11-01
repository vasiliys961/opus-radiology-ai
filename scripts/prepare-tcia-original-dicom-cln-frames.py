#!/usr/bin/env python3
"""Sample TCIA original DICOM image pixels after a fresh source-verified CLN forward.
Original SOP IDs remain local and are never included in cloud/provider artifacts.
"""
from __future__ import annotations
import argparse,hashlib,json
from pathlib import Path
import numpy as np
import nibabel as nib
import pydicom
from PIL import Image
CHAIN="bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61"
MODEL="8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87"
def digest(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
    return h.hexdigest()
def prepare(reference,work,numeric,local_map,out):
    proof=json.loads(local_map.read_text())
    actual=json.loads(numeric.read_text())
    native=work/"source-original-tcia-dicom.nii"
    source=digest(native)
    if (proof.get("schema")!="opus-tcia-original-dicom-cln-map/v1" or
        proof.get("sourceNativeSha256")!=source or
        proof.get("sourceDICOMChainSha256")!=CHAIN or
        proof.get("originalScannerDicom") is not True or
        proof.get("sourceSopGeometryVerified") is not True or
        actual.get("schema")!="opus-original-cln-TCIA-LCTSC-http-forward/v1" or
        actual.get("originalScannerDicom") is not True or
        actual.get("exactOriginalDICOMSeriesSopBindingVerified") is not True or
        actual.get("originalDICOMSourceChainSha256")!=CHAIN or
        actual.get("sourceNativeSha256")!=source or
        actual.get("originalCheckpointSHA256")!=MODEL or
        actual.get("realOriginalModelForwardCompleted") is not True or
        actual.get("authenticatedLocalHttpWorker") is not True or
        actual.get("clinicalValidation") is not False):
        raise ValueError("nonoriginal_dicom_or_model_run_unverified")
    scan=nib.load(str(native))
    dims=scan.shape
    if dims!=(512,512,103):raise ValueError("TCIA_source_shape_changed")
    sop_list=proof["nativeSopInstanceUids"]
    by_sop={}
    for path in sorted((reference/"dicom").glob("reference-*.dcm")):
        ds=pydicom.dcmread(str(path))
        sop=str(ds.SOPInstanceUID)
        if sop in by_sop:raise ValueError("duplicate_original_sop")
        by_sop[sop]=ds
    if len(sop_list)!=103 or set(sop_list)!=set(by_sop):
        raise ValueError("original_SOP_series_mismatch")
    candidates=actual["candidates"]
    if not isinstance(candidates,list) or len(candidates)!=actual["candidateCount"] or len(candidates)>10:
        raise ValueError("invalid_original_candidate_count")
    if candidates:
        center=float(candidates[0]["sourceVoxelCentroidIJK"][2])
        z=int(round(center))
        offsets=(-6,-2,0,4)
        indices=[min(102,max(0,z+o)) for o in offsets]
        if len(set(indices))!=4:
            indices=[max(0,min(102,z+o)) for o in (-4,-1,0,3)]
    else:indices=[0,34,68,102]
    if len(set(indices))!=4:raise ValueError("nonunique_sampled_original_slices")
    out.mkdir(parents=True,exist_ok=False)
    for i,k in enumerate(indices,1):
        ds=by_sop[sop_list[k]]
        source_plane=np.asarray(scan.dataobj[:,:,k],dtype=np.float32)
        hu=ds.pixel_array.astype(np.float32)*float(ds.RescaleSlope)+float(ds.RescaleIntercept)
        if not np.array_equal(hu,source_plane.T):
            raise ValueError("original_scanner_SOP_pixel_not_CLN_native_source")
        window=np.uint8(np.rint(np.clip((hu+1000)/1400*255,0,255)))
        Image.fromarray(window).convert("RGB").save(out/f"frame-{i}.png",optimize=True)
    mapping={
        "sourceImageSha256":source,"detectorSourceImageSha256":source,
        "imageDimensions":list(dims),
        "reviewedFrames":[{"frameId":f"frame-{i}","sourceAxialIndex":z}
                          for i,z in enumerate(indices,1)],
        "originalScannerDicom":True,
        "originalDicomSopRegistrationVerified":True,
        "sourceOriginalTCIAChainSha256":CHAIN,
        "localSopBinding":[{"frameId":f"frame-{i}","sop":sop_list[z]}
                           for i,z in enumerate(indices,1)],
    }
    (out/"frame-relative-map.json").write_text(json.dumps(mapping)+"\n")
    print("SOURCE ORIGINAL TCIA DICOM PIXELS BOUND TO FRESH CLN MODEL",json.dumps({
        "originalScannerDicom":True,"exactSopBound":True,
        "originalForward":True,"candidates":len(candidates),"sampledFrames":4,
        "clinicalValidation":False}),flush=True)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("reference","work","numeric","local-map","output"):
        p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args()
    prepare(a.reference,a.work,a.numeric,a.local_map,a.output)
