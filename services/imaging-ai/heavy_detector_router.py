"""Fail-closed execution routing for heavyweight 3D pathology detectors.

No network dispatch, file upload, or model launch here. This is a resource
admission decision used before a separate verified executable is selected.
"""
from dataclasses import asdict, dataclass

GIB = 1024 ** 3

@dataclass(frozen=True)
class DetectorAdmission:
    selected_mode: str
    may_execute: bool
    manual_override_available: bool
    reason: str
    cloud_transfer_allowed: bool
    local_model_autoload: bool


def route_heavy_detector(*, model: str, local_ram_gib: float,
                         cpu_server_ready: bool = False,
                         gpu_server_ready: bool = False,
                         study_deidentified: bool = False,
                         clinician_cloud_approved: bool = False,
                         provider_permits_transfer: bool = False,
                         manual_mode: str | None = None):
    if model not in {"lungscape191", "compai_lnq_model7", "nih_bone_lesions"}:
        raise ValueError("unsupported_detector")
    if not 0 < local_ram_gib <= 2048:
        raise ValueError("invalid_local_memory_capacity")
    if manual_mode not in (None, "local", "cpu_server", "gpu_server"):
        raise ValueError("invalid_manual_mode")
    cloud_allowed = bool(study_deidentified and clinician_cloud_approved
                         and provider_permits_transfer)
    # No silent remote transfer, even where a remote worker is online.
    available = []
    if gpu_server_ready and cloud_allowed:
        available.append("gpu_server")
    if cpu_server_ready and cloud_allowed:
        available.append("cpu_server")
    # Heavy 3D ensemble: conservative initial Mac cutoff, never equate model
    # compressed file size to peak resident inference memory.
    if local_ram_gib >= 32 and model != "lungscape191":
        available.append("local")
    if manual_mode:
        if manual_mode not in available:
            return DetectorAdmission(manual_mode, False, True,
                     "insufficient_resources_or_cloud_authorization",
                     cloud_allowed, False)
        chosen = manual_mode
    elif available:
        chosen = available[0]
    else:
        return DetectorAdmission("none", False, True,
             "no_authorized_resource_suitable_for_heavy_3d_model",
             cloud_allowed, False)
    return DetectorAdmission(chosen, True, True, "research_execution_admitted",
                             cloud_allowed, False)


if __name__ == "__main__":
    a = route_heavy_detector(model="lungscape191", local_ram_gib=8)
    assert a.selected_mode == "none" and not a.may_execute
    b = route_heavy_detector(model="lungscape191", local_ram_gib=8, gpu_server_ready=True,
           study_deidentified=True, clinician_cloud_approved=True,
           provider_permits_transfer=True)
    assert b.selected_mode == "gpu_server" and b.may_execute
    c = route_heavy_detector(model="lungscape191", local_ram_gib=8, gpu_server_ready=True,
           study_deidentified=False, clinician_cloud_approved=True, provider_permits_transfer=True)
    assert not c.may_execute
    print("Heavy 3D detector fail-closed admission PASS")
