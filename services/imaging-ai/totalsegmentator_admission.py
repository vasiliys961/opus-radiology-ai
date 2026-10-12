"""Fail-closed, unconnected TotalSegmentator resource gate (no inference or downloads)."""
from dataclasses import dataclass
from math import prod
MIB=1024**2
GIB=1024*MIB
MAX_VOXELS=512*512*300
MIN_RESERVE=512*MIB

@dataclass(frozen=True)
class ResourceEvidence:
    checkpoint_sha256: str
    measured_peak_bytes: int
    hardware_profile: str
    task: str="total-fast-lobes-ct"
    verified: bool=False

def admission(dimensions, available_ram_bytes, available_disk_bytes, evidence,
              checkpoint_sha256, hardware_profile, reserve_bytes=MIN_RESERVE):
    def reject(reason):
        return {"canAdmit":False,"reason":reason,"clinicalStatus":"unverified_research_draft"}
    if (not isinstance(dimensions,(tuple,list)) or len(dimensions)!=3 or
            any(type(x) is not int or x<1 for x in dimensions) or
            dimensions[0]>512 or dimensions[1]>512 or dimensions[2]>300 or
            prod(dimensions)>MAX_VOXELS):
        return reject("invalid_dimensions")
    if (any(type(n) is not int or n<0 for n in
            (available_ram_bytes,available_disk_bytes,reserve_bytes)) or
            reserve_bytes<MIN_RESERVE):
        return reject("invalid_resource_input")
    if not isinstance(evidence,ResourceEvidence) or not evidence.verified:
        return reject("missing_verified_resource_evidence")
    if (not isinstance(checkpoint_sha256,str) or len(checkpoint_sha256)!=64 or
            any(c not in "0123456789abcdef" for c in checkpoint_sha256) or
            evidence.checkpoint_sha256!=checkpoint_sha256 or
            evidence.hardware_profile!=hardware_profile or
            evidence.task!="total-fast-lobes-ct" or
            type(evidence.measured_peak_bytes) is not int or
            not 0<evidence.measured_peak_bytes<=128*GIB):
        return reject("resource_evidence_mismatch")
    disk=prod(dimensions)*5+256*MIB
    ram=evidence.measured_peak_bytes+reserve_bytes
    if available_ram_bytes<ram:
        return {**reject("insufficient_memory"),"requiredRamBytes":ram}
    if available_disk_bytes<disk:
        return {**reject("insufficient_disk"),"requiredDiskBytes":disk}
    return {"canAdmit":True,"reason":"measured_budget_only",
            "requiredRamBytes":ram,"requiredDiskBytes":disk,
            "clinicalStatus":"unverified_research_draft","inferenceEnabled":False}
