#!/usr/bin/env python3
"""Create source-bound native CT NIfTI from already verified public 103-DICOM LCTSC ZIP."""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path

import numpy as np
import pydicom

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("lctsc_reference", ROOT/"scripts/download-r231-browser-reference.py")
ref=importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)

def assemble_public_ct(reference_dir, output_path):
    folder=Path(reference_dir)
    output=Path(output_path)
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("invalid_destination")
    manifest=json.loads((folder/"reference.json").read_text(encoding="utf-8"))
    if (manifest.get("schema")!="opus-r231-browser-reference/v1"
            or manifest.get("collection")!="TCIA LCTSC"
            or manifest.get("license")!="CC BY 3.0"
            or manifest.get("sourceContentChainSha256")!=ref.CONTENT_CHAIN
            or manifest.get("allSourceFrames") is not True
            or manifest.get("selectedFrames")!=ref.TOTAL
            or manifest.get("dimensions")!=[512,512,ref.TOTAL]
            or manifest.get("selectedIndicesZeroBased")!=[0,ref.TOTAL-1]):
        raise ValueError("not_pinned_complete_public_reference")
    files=sorted((folder/"dicom").glob("reference-*.dcm"))
    hashes=manifest.get("selectedFileSha256")
    candidates=manifest.get("niftiCandidates")
    if (len(files)!=ref.TOTAL or not isinstance(hashes,list)
            or len(hashes)!=ref.TOTAL or not isinstance(candidates,list)
            or len(candidates)!=2 or not isinstance(candidates[0],dict)):
        raise ValueError("incomplete_dicom_series")
    affine=candidates[0].get("affineLps")
    expected=candidates[0].get("inputSha256")
    if (not isinstance(affine,list) or len(affine)!=12
            or not isinstance(expected,str) or len(expected)!=64):
        raise ValueError("missing_nifti_binding")
    header=ref.nifti_header(affine,ref.TOTAL)
    digest=hashlib.sha256()
    byte_count=0
    try:
        with output.open("xb") as stream:
            stream.write(header)
            digest.update(header)
            byte_count+=len(header)
            for index,file in enumerate(files):
                if file.is_symlink() or file.name!=f"reference-{index:03}.dcm":
                    raise ValueError("unexpected_reference_file")
                raw=file.read_bytes()
                if hashlib.sha256(raw).hexdigest()!=hashes[index]:
                    raise ValueError("dicom_content_mismatch")
                ds=pydicom.dcmread(io.BytesIO(raw))
                if (ds.Modality!="CT" or str(ds.SeriesInstanceUID)!=ref.SERIES
                        or (int(ds.Rows),int(ds.Columns))!=(512,512)
                        or float(ds.RescaleSlope)!=1 or float(ds.RescaleIntercept)!=-1000):
                    raise ValueError("unexpected_dicom_metadata")
                hu=ds.pixel_array.astype(np.float32)-np.float32(1000)
                if hu.shape!=(512,512) or not np.isfinite(hu).all():
                    raise ValueError("invalid_dicom_pixels")
                # DICOM row-major rows/columns match NIfTI x-fastest native layout.
                data=hu.astype("<f4",copy=False).tobytes(order="C")
                stream.write(data)
                digest.update(data)
                byte_count+=len(data)
        if byte_count!=352+512*512*ref.TOTAL*4:
            raise ValueError("nifti_size_mismatch")
        if digest.hexdigest()!=expected:
            raise ValueError("nifti_source_binding_mismatch")
    except BaseException:
        output.unlink(missing_ok=True)
        raise
    return {"status":"prepared_public_native_ct","dimensions":[512,512,ref.TOTAL],
            "inputSha256":digest.hexdigest(),"bytes":byte_count,
            "anatomicalCompletenessVerified":False,"clinicalStatus":"not_validated"}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference",required=True,type=Path)
    parser.add_argument("--output",required=True,type=Path)
    args=parser.parse_args()
    print(json.dumps(assemble_public_ct(args.reference,args.output),sort_keys=True))

if __name__=="__main__":
    main()
