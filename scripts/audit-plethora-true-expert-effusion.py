#!/usr/bin/env python3
"""Real public PleThora expert pleural-effusion annotation cross-reader audit.

TCIA PleThora CC BY 3.0, version 3 2020/07/28. Original pleural-effusion
annotated NIfTI file downloaded from TCIA wiki with two independently
revised HUMAN label files for the same deidentified case. Compute HUMAN
inter-reader Dice, not a pretrained model score. No source CT pixels,
patient identifiers or mask files published in GitHub artifacts.

Clinical limitations: expert fluid masks may omit gross tumor overlap;
native ROI orientation RPI differs from original DICOM RAI, so original CT
registration must be separately proven before evaluating a model.
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse
from urllib.request import Request,urlopen
import zipfile

URL=("https://wiki.cancerimagingarchive.net/download/attachments/68551327/"
     "PleThora%20Effusions%20June%202020.zip?api=v2&modificationDate=1593202778373&version=1")
DOI="10.7937/tcia.2020.6c7y-gq39"
MAX_ZIP=8*1024**2
MAX_UNCOMPRESSED_NIFTI=256*1024**2
MAX_VOXELS=512*512*400
SCHEMA="opus-plethora-true-physician-pleural-effusion-reference-v1"


def verified_publisher_archive():
    request=Request(URL,headers={
        "User-Agent":"Opus-Radiology-AI-Reproducible-Academic-Research/1",
        "Accept":"application/zip,application/octet-stream,*/*"})
    with urlopen(request,timeout=70) as response:
        target=urlparse(response.url)
        if target.scheme!="https" or target.hostname not in (
            "wiki.cancerimagingarchive.net","www.cancerimagingarchive.net"):
            raise ValueError("source_redirect_outside_tcia_official_domain")
        if response.status!=200:
            raise ValueError("published_reference_not_accessible")
        pieces=[]
        size=0
        while True:
            block=response.read(128*1024)
            if not block:break
            size+=len(block)
            if size>MAX_ZIP:raise ValueError("reference_archive_exceeds_size_bound")
            pieces.append(block)
    raw=b"".join(pieces)
    if len(raw)<10000 or not zipfile.is_zipfile(io.BytesIO(raw)):
        raise ValueError("published_reference_zip_not_valid")
    return raw


def _name_map(archive):
    results={}
    for entry in archive.infolist():
        from pathlib import PurePosixPath
        p=PurePosixPath(entry.filename)
        if (p.is_absolute() or ".." in p.parts or
            entry.file_size>MAX_UNCOMPRESSED_NIFTI or
            (entry.external_attr>>16)&0o170000==0o120000):
            raise ValueError("unsafe_or_oversized_published_annotation")
        base=p.name
        match=re.fullmatch(r"(LUNG1-\d+)_effusion_(first|second)_reviewer\.nii\.gz",
                           base,re.IGNORECASE)
        if match:
            key,reviewer=match.group(1).upper(),match.group(2).lower()
            if (key,reviewer) in results:raise ValueError("duplicate_expert_case_reviewer")
            results[(key,reviewer)]=entry
    return results


def measure_case(mask_a,mask_b,archive_hash):
    import nibabel as nib
    import numpy as np
    with tempfile.TemporaryDirectory() as d:
        p1=Path(d)/"expert_a.nii.gz"
        p2=Path(d)/"expert_b.nii.gz"
        p1.write_bytes(mask_a);p2.write_bytes(mask_b)
        a,b=nib.load(str(p1)),nib.load(str(p2))
        if (a.ndim!=3 or b.ndim!=3 or a.shape!=b.shape or
            math.prod(a.shape)>MAX_VOXELS or
            a.header.get_xyzt_units()[0]!="mm" or b.header.get_xyzt_units()[0]!="mm"):
            raise ValueError("original_expert_masks_have_incompatible_grid_or_units")
        world1=np.asarray(a.affine);world2=np.asarray(b.affine)
        if (not np.isfinite(world1).all() or not np.isfinite(world2).all() or
            abs(np.linalg.det(world1[:3,:3]))<.000001):
            raise ValueError("original_expert_masks_invalid_physical_geometry")
        for x in (0,a.shape[0]-1):
            for y in (0,a.shape[1]-1):
                for z in (0,a.shape[2]-1):
                    loc=np.array([x,y,z,1.])
                    if np.linalg.norm((world1@loc-world2@loc)[:3])>.05:
                        raise ValueError("original_expert_masks_do_not_share_native_grid")
        if (a.header.get_data_dtype().kind not in "ui" or
            b.header.get_data_dtype().kind not in "ui"):
            raise ValueError("original_expert_masks_must_be_integer")
        original_a=np.asarray(a.dataobj)
        original_b=np.asarray(b.dataobj)
        if (not np.isin(original_a,[0,1]).all() or not np.isin(original_b,[0,1]).all()):
            raise ValueError("unknown_original_pleural_reference_labels")
        mask1=original_a==1;mask2=original_b==1
        count1=int(mask1.sum());count2=int(mask2.sum())
        if not count1 or not count2:raise ValueError("no_bilateral_human_reference_masks")
        intersection=int(np.logical_and(mask1,mask2).sum())
        volume=abs(np.linalg.det(world1[:3,:3]))/1000.
        discordant_z=np.flatnonzero(np.any(np.logical_xor(mask1,mask2),axis=(0,1)))
        return {
          "schema":SCHEMA,
          "reference":"PleThora manually reviewed pleural effusion segmentations",
          "publisher":"TCIA","publisherDoi":DOI,"rights":"CC BY 3.0",
          "originalPublishedZipSha256":archive_hash,
          "originalExpertAMaskSha256":hashlib.sha256(mask_a).hexdigest(),
          "originalExpertBMaskSha256":hashlib.sha256(mask_b).hexdigest(),
          "referencePatientIdIncluded":False,
          "originalShapeXYZ":list(a.shape),
          "sourceWorldAffineMatchedWithinMm":.05,
          "originalNativeSpatialUnits":"mm",
          "originalReviewerAMaskVoxels":count1,
          "originalReviewerBMaskVoxels":count2,
          "originalExpertIntersectionVoxels":intersection,
          "humanExpertInterreaderDice":round(2*intersection/(count1+count2),8),
          "originalReviewerAMaskVolumeMl":round(count1*volume,5),
          "originalReviewerBMaskVolumeMl":round(count2*volume,5),
          "humanExpertDiscordantSliceCount":len(discordant_z),
          "modelInferencePerformed":False,
          "expertHumanAgreementIsModelAccuracy":False,
          "correspondingOriginalCtDownloaded":False,
          "nativeMaskToOriginalDicomGeometryVerified":False,
          "medicalUseValidated":False,
          "limitations":[
            "This is human-human expert mask overlap, not detector segmentation Dice.",
            "Original PleThora RPI NIfTI and RAI DICOM differ in orientation; register original CT before comparing any pretrained model.",
            "PleThora effusion masks may omit tumor-overlapping GTV areas.",
            "A single expert reference does not establish clinical sensitivity."
          ]
        }


def run():
    raw=verified_publisher_archive()
    archive_sha=hashlib.sha256(raw).hexdigest()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names=_name_map(archive)
        cases=sorted(set(k for k,r in names if r=="first")&
                     set(k for k,r in names if r=="second"))
        if not cases:raise ValueError("no_both_original_human_reviewer_pair")
        # Choose a deterministically selected shared pair, no browsing patient data.
        first=cases[0]
        a=archive.read(names[(first,"first")])
        b=archive.read(names[(first,"second")])
        result=measure_case(a,b,archive_sha)
        result["multipleOriginalExpertReviewPairsPresent"]=len(cases)
        result["caseSelection"]="first_alphabetically_paired_pseudonymous_case"
        return result


if __name__=="__main__":
    report=run()
    out=Path(os.environ.get("OPUS_PLETHORA_NUMBERS_OUT","/tmp/opus-plethora-human-expert-reference.json"))
    if out.exists() or out.suffix!=".json":raise ValueError("only_new_numeric_file")
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2))
    print(json.dumps({k:report[k] for k in (
      "publisherDoi","multipleOriginalExpertReviewPairsPresent",
      "originalReviewerAMaskVoxels","originalReviewerBMaskVoxels",
      "humanExpertInterreaderDice","medicalUseValidated"
    )}))
