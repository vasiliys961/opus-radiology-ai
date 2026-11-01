#!/usr/bin/env python3
"""Fetch pinned original public TCIA LCTSC DICOM from official IDC (NBIA fallback).

No trust in download origin alone: require all 103 original source DICOM files,
exact modality/series, and original TCIA publisher's immutable SHA-256 chain.
IDC may harmonize DICOM bytes; in that case reject instead of silently accepting.
"""
from __future__ import annotations
import argparse,importlib.util,io,json,shutil,subprocess,sys,tempfile,zipfile
from pathlib import Path
import pydicom
ROOT=Path(__file__).resolve().parents[1]
MODULE=ROOT/"scripts/download-r231-browser-reference.py"
def ref_module():
    spec=importlib.util.spec_from_file_location("opus_tcia_source",MODULE)
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
    return mod
def download_from_idc(out:Path):
    source=ref_module()
    with tempfile.TemporaryDirectory(prefix="opus-tcia-idc-original-") as directory:
        scratch=Path(directory)
        raw=scratch/"idc"
        cmd=["idc","download",source.SERIES,"--download-dir",str(raw),
             "--dir-template",""]
        subprocess.run(cmd,check=True,timeout=300,capture_output=True,text=True)
        objects=[p for p in raw.rglob("*") if p.is_file()]
        if len(objects)!=source.TOTAL:
            raise ValueError("IDC_series_object_count_mismatch")
        dicoms=[]
        for file in objects:
            ds=pydicom.dcmread(str(file),stop_before_pixels=True)
            if (str(ds.SeriesInstanceUID)!=source.SERIES or ds.Modality!="CT"
                or int(ds.Rows)!=512 or int(ds.Columns)!=512):
                raise ValueError("not_pinned_original_TCIA_series")
            dicoms.append(file)
        zipfile_path=scratch/"original-bytes.zip"
        with zipfile.ZipFile(zipfile_path,"w",compression=zipfile.ZIP_STORED) as z:
            z.writestr("LICENSE","TCIA LCTSC public research source, CC BY 3.0. "+
             "Source: https://www.cancerimagingarchive.net/collection/lctsc/")
            for i,file in enumerate(dicoms):
                z.write(file,arcname=f"public-original-{i:03d}.dcm")
        result=source.prepare(zipfile_path,out,full_series=True)
        if (result.get("sourceContentChainSha256")!=source.CONTENT_CHAIN or
            result.get("selectedFrames")!=103 or result.get("allSourceFrames") is not True):
            raise ValueError("original_publisher_SHA_chain_mismatch")
    print("IMMUTABLE ORIGINAL TCIA 103 DICOM BYTES VERIFIED FROM IDC",flush=True)
def main():
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    if args.output.exists():raise ValueError("source_output_directory_must_be_new")
    try:
        download_from_idc(args.output)
    except Exception as idc_error:
        print("IDC exact-byte check unavailable; trying official NBIA pinned original ZIP:",
              type(idc_error).__name__,flush=True)
        if args.output.exists():
            shutil.rmtree(args.output)
        # Official fallback applies exactly the same independent DICOM file SHA chain.
        cmd=[sys.executable,str(ROOT/"scripts/download-ai-cac-known-lctsc.py"),
             "--output",str(args.output)]
        subprocess.run(cmd,check=True,timeout=520)
        print("IMMUTABLE ORIGINAL TCIA 103 DICOM BYTES VERIFIED FROM NBIA",flush=True)
if __name__=="__main__":
    main()
