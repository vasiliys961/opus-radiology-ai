#!/usr/bin/env python3
"""Public NLST original chest-CT probe/admission, no model, no patient pixels in CI.

NLST TCIA CC BY 4.0, NOT Stanford COCA. Never call this expert CAC validation.
Probe reads only TCIA metadata; download is explicit and fully ephemeral.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.parse
import urllib.request
import zipfile

BASE="https://nlst.cancerimagingarchive.net/nbia-api/services/"
COLLECTION="NLST"
PUBLIC_PATIENT_CODE="100147"  # TCIA public pseudonymous query code; never log.
SCHEMA="opus-ai-cac-nlst-public-source-admission/v1"
MAX_ARCHIVE=400*1024**2
MAX_EXPANDED=800*1024**2
MAX_SLICES=384
DOI="10.7937/TCIA.HMQ8-J677"

def api_url(method, **params):
    if method not in ("getSeries","getImage"):
        raise ValueError("nonallowlisted_TCIA_operation")
    return BASE+method+"?"+urllib.parse.urlencode(params)

def request(url):
    parsed=urllib.parse.urlparse(url)
    if parsed.hostname!="nlst.cancerimagingarchive.net" or parsed.scheme!="https":
        raise ValueError("not_original_official_public_NLST_endpoint")
    return urllib.request.urlopen(urllib.request.Request(
        url,headers={"User-Agent":"OpusRadiologyAI-PublicAcademicResearch/1"}),timeout=90)

def candidate_metadata():
    with request(api_url("getSeries",Collection=COLLECTION,PatientID=PUBLIC_PATIENT_CODE,Modality="CT")) as response:
        raw=response.read(3*1024**2+1)
    if len(raw)>3*1024**2:
        raise ValueError("unexpectedly_large_public_NLST_metadata")
    items=json.loads(raw)
    if not isinstance(items,list) or len(items)>2000:
        raise ValueError("not_bounded_official_NLST_series_metadata")
    candidates=[]
    for row in items:
        if not isinstance(row,dict) or str(row.get("Collection","")).upper()!=COLLECTION:
            continue
        if str(row.get("Modality","")).upper()!="CT":
            continue
        n=int(row.get("ImageCount",0) or 0)
        if not 16<=n<=MAX_SLICES:
            continue
        license_text=str(row.get("LicenseURI","")).lower()
        if license_text and "creativecommons.org/licenses/by/4.0" not in license_text:
            continue
        sid=str(row.get("SeriesInstanceUID",""))
        if not re.fullmatch(r"\d+(?:\.\d+){4,}",sid):
            continue
        if str(row.get("BodyPartExamined","")).upper() not in ("CHEST","THORAX","LUNG",""):
            continue
        candidates.append((sid,n,row))
    candidates.sort(key=lambda item:(abs(item[1]-90),item[0]))
    return candidates, len(items)

def bounded_download(series_uid, target):
    import pydicom
    if target.exists() or target.is_symlink():
        raise ValueError("new_ephemeral_directory_required")
    target.mkdir(mode=0o700,parents=True)
    archive=target/"source.zip"
    with request(api_url("getImage",SeriesInstanceUID=series_uid)) as response, archive.open("xb") as dest:
        count=0
        while chunk:=response.read(1024*1024):
            count+=len(chunk)
            if count>MAX_ARCHIVE:
                raise ValueError("large_original_CT_archive_refused")
            dest.write(chunk)
    if not zipfile.is_zipfile(archive):
        raise ValueError("official_NLST_image_download_not_a_zip")
    with zipfile.ZipFile(archive) as z:
        valid=[]
        total=0
        for e in z.infolist():
            # Original TCIA archives contain a LICENSE file.
            if e.is_dir():
                continue
            p=Path(e.filename)
            if p.is_absolute() or ".." in p.parts or e.file_size>4*1024**2:
                raise ValueError("untrusted_original_NLST_zip_entry")
            if p.name=="LICENSE":
                continue
            total+=e.file_size
            if total>MAX_EXPANDED:
                raise ValueError("original_CT_too_large")
            with z.open(e) as file:
                ds=pydicom.dcmread(file,stop_before_pixels=True)
            if (str(getattr(ds,"Modality",""))!="CT" or
                str(getattr(ds,"SeriesInstanceUID",""))!=series_uid):
                raise ValueError("mixed_source_or_not_CT_zip_member")
            valid.append(e)
        if not 16<=len(valid)<=MAX_SLICES:
            raise ValueError("not_full_bounded_original_NLST_CT_series")
        dicom=target/"dicom"
        dicom.mkdir(mode=0o700)
        for i,e in enumerate(valid):
            (dicom/f"source-{i:04d}.dcm").write_bytes(z.read(e))
    archive.unlink()
    # Validate using the *actual Opus AI-CAC research input contract*, not
    # just TCIA metadata; this does not independently prove the absence of IV contrast.
    from importlib import util
    script=Path(__file__).with_name("real-ai-cac-public-ct.py")
    spec=util.spec_from_file_location("ai_cac_public",script)
    module=util.module_from_spec(spec)
    spec.loader.exec_module(module)
    info=module.select_public_ct_slices(dicom)
    record={
        "schema":SCHEMA, "collection":COLLECTION,
        "sourceURL":"https://www.cancerimagingarchive.net/collection/nlst/",
        "sourceLicense":"CC BY 4.0",
        "originalAcquisition":"NLST low-dose screening chest CT; noncontrast expected from study protocol",
        "studyProtocolNoncontrastIndependentlyVerified":False,
        "sourceFullNativeSeriesSelected":True,
        "sourceShape":list(info["shape"]),
        "originalDICOMSha256Chain":info["sourceSha256"],
        "voxelSpacingMm":info["voxelSpacingMm"],
        "realAI_CACInferencePerformed":False,
        "expertCoronaryMaskAvailable":False,
        "independentTrainingHoldoutEstablished":False,
        "clinicalValidation":False,
        "rights":"Public original NLST TCIA CC BY 4.0; no DICOM images in GitHub artifacts"
    }
    (target/"source-admission.json").write_text(json.dumps(record,indent=2)+"\n")
    return record

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--mode",choices=("probe","download"),required=True)
    p.add_argument("--destination",type=Path)
    a=p.parse_args()
    c,total=candidate_metadata()
    print(json.dumps({"collection":"NLST","sourceApiResponded":True,
                      "candidateCount":len(c),"totalMetadataSeries":total,
                      "patientIdentifiersOutput":False}))
    if a.mode=="probe":
        if not c:raise ValueError("no_TCIA_series_matching_research_constraints")
        return
    if not a.destination:
        raise ValueError("ephemeral_source_output_required")
    # Deterministic shortlist bounded to 3 genuine TCIA collections series.
    # Metadata alone cannot prove image geometry; reject mismatched first
    # rather than trying arbitrary unrelated CT until one is convenient.
    if not c:raise ValueError("no_bounded_public_NLST_candidate")
    rec=bounded_download(c[0][0],a.destination)
    print(json.dumps({"realOriginalPublicSourceAvailable":True,
                      "shape":rec["sourceShape"],
                      "sourceChainSHA256":rec["originalDICOMSha256Chain"],
                      "actualTrainedInference":False}))

if __name__=="__main__":
    main()
