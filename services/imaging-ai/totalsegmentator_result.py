"""Validate a native-grid TotalSegmentator mask with bounded memory; no inference."""
import hashlib
import math
import struct
from pathlib import Path
from totalsegmentator_audit import LUNG_LOBES

def validate_native_mask(path, dimensions, affine_lps, source_identity_sha256, allowed_labels=None):
    if (not isinstance(dimensions,(tuple,list)) or len(dimensions)!=3 or
        any(type(d) is not int or not 1<=d<=lim for d,lim in zip(dimensions,(512,512,300)))):
        raise ValueError("invalid_dimensions")
    if (not isinstance(affine_lps,(tuple,list)) or len(affine_lps)!=12 or
        any(type(x) not in (int,float) or not math.isfinite(x) for x in affine_lps)):
        raise ValueError("invalid_affine")
    if (not isinstance(source_identity_sha256,str) or len(source_identity_sha256)!=64 or
        any(ch not in "0123456789abcdef" for ch in source_identity_sha256)):
        raise ValueError("invalid_source_identity")
    if allowed_labels is None:
        ids=set(LUNG_LOBES)
    elif (not isinstance(allowed_labels,(list,tuple,set)) or
          any(type(i) is not int for i in allowed_labels)):
        raise ValueError("invalid_label_set")
    else:
        ids=set(allowed_labels)
    if not ids or not ids.issubset(LUNG_LOBES):
        raise ValueError("invalid_label_set")
    count=math.prod(dimensions)
    path=Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size!=352+count:
        raise ValueError("invalid_mask_file")
    counts={i:0 for i in sorted(ids)}
    digest=hashlib.sha256()
    with path.open("rb") as stream:
        header=stream.read(352)
        digest.update(header)
        if (len(header)!=352 or struct.unpack_from("<i",header,0)[0]!=348 or
            header[344:348]!=b"n+1\x00" or struct.unpack_from("<h",header,40)[0]!=3 or
            list(struct.unpack_from("<3h",header,42))!=list(dimensions) or
            struct.unpack_from("<hh",header,70)!=(2,8) or
            struct.unpack_from("<f",header,108)[0]!=352 or
            struct.unpack_from("<ff",header,112)!=(1.,0.) or
            not 1 <= struct.unpack_from("<h",header,254)[0] <= 4):
            raise ValueError("invalid_mask_header")
        actual=list(struct.unpack_from("<12f",header,280))
        actual=[-v if i<8 else v for i,v in enumerate(actual)]
        for x in (0,dimensions[0]-1):
            for y in (0,dimensions[1]-1):
                for z in (0,dimensions[2]-1):
                    d2=sum((sum((actual[row*4+k]-affine_lps[row*4+k])*v
                        for k,v in enumerate((x,y,z,1)))**2) for row in range(3))
                    if d2>0.05**2:
                        raise ValueError("mask_geometry_mismatch")
        remaining=count
        while remaining:
            data=stream.read(min(128*1024,remaining))
            if not data:
                raise ValueError("truncated_mask")
            digest.update(data)
            for value in set(data):
                if value!=0 and value not in ids:
                    raise ValueError("unexpected_mask_label")
            for label in ids:
                counts[label]+=data.count(label)
            remaining-=len(data)
        if stream.read(1):
            raise ValueError("oversized_mask")
    if not any(counts.values()):
        raise ValueError("empty_mask_needs_review")
    return {"schema":"opus-totalsegmentator-validated-mask/v1",
        "sourceIdentitySha256":source_identity_sha256,"maskSha256":digest.hexdigest(),
        "dimensions":list(dimensions),"labelVoxels":[{"id":i,"name":LUNG_LOBES[i],
        "voxels":counts[i]} for i in sorted(ids)],"clinicalStatus":"unverified_research_draft",
        "modelProvenance":"not_verified_by_mask_validation"}
