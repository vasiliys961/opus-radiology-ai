#!/usr/bin/env python3
"""Extract a source-bound native contiguous label slab for the bounded MPR viewer.

Never resamples labels or manufactures missing CT slices. Public research use only.
The matching unmodified DICOM source slices must be loaded independently in MPR.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import stat
import struct

SOURCE_SHAPE_LIMITS=(512,512,300)
BROWSER_MAX_VOXELS=8_388_608
LOBE_IDS=(10,11,12,13,14)
ABDOMEN_IDS=(1,2,3,5)
PROFILES={"lung-lobes":LOBE_IDS,"abdomen-four-organs":ABDOMEN_IDS}


def sha256(path):
    digest=hashlib.sha256()
    with Path(path).open("rb") as f:
        while chunk:=f.read(131072):
            digest.update(chunk)
    return digest.hexdigest()


def extract(mask_path, report_path, output_path, manifest_path, start, count,
            expected_source_sha, research_profile="lung-lobes"):
    if research_profile not in PROFILES:
        raise ValueError("unsupported_research_profile")
    labels=PROFILES[research_profile]
    mask=Path(mask_path)
    report=Path(report_path)
    output=Path(output_path)
    manifest=Path(manifest_path)
    if any(p.is_symlink() for p in (mask, report, output, manifest)):
        raise ValueError("unsafe_symlink")
    if (not mask.is_file() or not report.is_file() or
            output.exists() or manifest.exists() or output==manifest or
            not output.parent.is_dir() or not manifest.parent.is_dir()):
        raise ValueError("invalid_paths")
    if not isinstance(start,int) or isinstance(start,bool) or start<0:
        raise ValueError("invalid_slab_range")
    if not isinstance(count,int) or isinstance(count,bool) or count<1:
        raise ValueError("invalid_slab_range")
    if (not isinstance(expected_source_sha,str) or
            len(expected_source_sha)!=64 or
            any(ch not in "0123456789abcdef" for ch in expected_source_sha)):
        raise ValueError("invalid_source_binding")
    if report.stat().st_size>65536:
        raise ValueError("invalid_inference_report")
    evidence=json.loads(report.read_text(encoding="utf-8"))
    if (not isinstance(evidence,dict) or
            evidence.get("schema")!="opus-totalseg-first-inference/v1" or
            evidence.get("status")!="completed_unvalidated" or
            evidence.get("readyForClinicalUse") is not False or
            evidence.get("sourceSha256")!=expected_source_sha or
            not isinstance(evidence.get("maskSha256"),str) or
            len(evidence["maskSha256"])!=64):
        raise ValueError("source_or_model_result_unverified")
    if (research_profile=="abdomen-four-organs" and
            evidence.get("researchProfile")!="abdomen-four-organs"):
        raise ValueError("source_or_model_result_unverified")
    if (evidence.get("researchProfile") not in (None,research_profile)):
        raise ValueError("source_or_model_result_unverified")
    if sha256(mask)!=evidence["maskSha256"]:
        raise ValueError("mask_sha_mismatch")
    descriptor=os.open(mask,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    try:
        info=os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise ValueError("invalid_mask_file")
        header=os.read(descriptor,352)
        if (len(header)!=352 or struct.unpack_from("<i",header,0)[0]!=348
                or header[344:348]!=b"n+1\x00"
                or struct.unpack_from("<h",header,40)[0]!=3):
            raise ValueError("invalid_mask_header")
        dims=tuple(struct.unpack_from("<3h",header,42))
        if any(not 1<=size<=bound for size,bound in zip(dims,SOURCE_SHAPE_LIMITS)):
            raise ValueError("invalid_source_shape")
        if (struct.unpack_from("<hh",header,70)!=(2,8)
                or struct.unpack_from("<f",header,108)[0]!=352.
                or (header[123]&7)!=2
                or not 1<=struct.unpack_from("<h",header,254)[0]<=2
                or info.st_size!=352+math.prod(dims)):
            raise ValueError("invalid_native_mask_format")
        if (start+count>dims[2] or math.prod(dims[:2])*count>BROWSER_MAX_VOXELS):
            raise ValueError("slab_exceeds_browser_limits")
        affine=[list(struct.unpack_from("<4f",header,280+16*row)) for row in range(3)]
        if (any(not math.isfinite(x) for row in affine for x in row) or
                abs(affine[0][0]*(affine[1][1]*affine[2][2]-affine[1][2]*affine[2][1])
                    -affine[0][1]*(affine[1][0]*affine[2][2]-affine[1][2]*affine[2][0])
                    +affine[0][2]*(affine[1][0]*affine[2][1]-affine[1][1]*affine[2][0]))<1e-9):
            raise ValueError("invalid_mask_geometry")
        out_header=bytearray(header)
        struct.pack_into("<4h",out_header,40,3,dims[0],dims[1],count)
        # The original qform origin no longer describes the cropped grid.
        # Keep verified sform, explicitly disable inconsistent qform.
        struct.pack_into("<h",out_header,252,0)
        for row in range(3):
            affine[row][3]+=start*affine[row][2]
            struct.pack_into("<4f",out_header,280+16*row,*affine[row])
        slab_bytes=math.prod(dims[:2])*count
        os.lseek(descriptor,352+start*math.prod(dims[:2]),os.SEEK_SET)
        counts={i:0 for i in labels}
        digest=hashlib.sha256()
        try:
            with output.open("xb") as target:
                target.write(out_header)
                digest.update(out_header)
                left=slab_bytes
                while left:
                    data=os.read(descriptor,min(left,131072))
                    if not data:
                        raise ValueError("truncated_native_mask")
                    if any(x not in (0,*labels) for x in set(data)):
                        raise ValueError("unexpected_mask_label")
                    for label in labels:
                        counts[label]+=data.count(label)
                    target.write(data)
                    digest.update(data)
                    left-=len(data)
            summary={
                "schema":"opus-totalseg-native-mpr-slab/v1" if research_profile=="lung-lobes"
                    else "opus-totalseg-abdomen-native-mpr-slab/v1",
                "researchProfile":research_profile,
                "sourceFullCtSha256":expected_source_sha,
                "sourceFullMaskSha256":evidence["maskSha256"],
                "slabMaskSha256":digest.hexdigest(),
                "sourceDimensions":list(dims),
                "slabDimensions":[dims[0],dims[1],count],
                "firstOriginalSliceIndexZeroBased":start,
                "lastOriginalSliceIndexZeroBased":start+count-1,
                "labelVoxels":[{"id":i,"voxels":counts[i]} for i in labels],
                "sourceGridGeometry":"native_contiguous_unresampled",
                "clinicalStatus":"not_validated",
                "fullAnatomicCoverageVerified":False,
                "readyForClinicalUse":False,
            }
            with manifest.open("x",encoding="utf-8") as fd:
                json.dump(summary,fd,sort_keys=True)
            return summary
        except BaseException:
            output.unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)
            raise
    finally:
        os.close(descriptor)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--mask",required=True,type=Path)
    p.add_argument("--report",required=True,type=Path)
    p.add_argument("--output",required=True,type=Path)
    p.add_argument("--manifest",required=True,type=Path)
    p.add_argument("--start",required=True,type=int)
    p.add_argument("--count",required=True,type=int)
    p.add_argument("--expected-source-sha256",required=True)
    p.add_argument("--research-profile",choices=tuple(PROFILES),default="lung-lobes")
    a=p.parse_args()
    result=extract(a.mask,a.report,a.output,a.manifest,a.start,a.count,
                   a.expected_source_sha256, a.research_profile)
    print(json.dumps(result,sort_keys=True))


if __name__=="__main__":
    main()
