"""Conservative local CPU estimates, not an M1/system-memory acceptance claim."""
from math import prod

MIB = 1024**2
HARD_RSS_LIMIT = 2 * 1024**3
SYSTEM_RESERVE = 256 * MIB
PROFILES = {
    "safe": {"threads": 1, "interOpThreads": 1, "baseRamBytes": 704 * MIB,
             "bytesPerVoxel": 8, "marginBytes": 384 * MIB},
    "balanced": {"threads": 2, "interOpThreads": 1, "baseRamBytes": 896 * MIB,
                 "bytesPerVoxel": 32, "marginBytes": 512 * MIB},
}


def estimate_resources(dimensions, frame_count, profile="safe", full_stream=False):
    if profile not in PROFILES:
        raise ValueError("unsupported_resource_profile")
    if (len(dimensions) != 3 or any(type(n) is not int or n < 1 for n in dimensions)
            or type(frame_count) is not int or frame_count != dimensions[2]):
        raise ValueError("invalid_resource_geometry")
    voxels = prod(dimensions)
    if full_stream and (dimensions[0] > 512 or dimensions[1] > 512 or not 3 <= frame_count <= 300):
        raise ValueError("full_stream_geometry_limit")
    if not full_stream and voxels > 8_388_608:
        raise ValueError("voxel_limit")
    policy = PROFILES[profile]
    # One weight allocation, single native-plane preprocessing/restoration,
    # mapped float32 input + uint8 output, and whole compact-volume connected
    # components. Native and compact workspaces must be budgeted separately.
    # Coefficients remain provisional: measured Linux + prior M1 evidence are
    # not a complete near-threshold M1/system-memory acceptance.
    model_bytes = (policy["baseRamBytes"] + (16 * MIB if full_stream else voxels * policy["bytesPerVoxel"])
                   + frame_count * 256 * 256 * 32 + dimensions[0] * dimensions[1] * 12)
    return {"profile": profile, "estimatedModelRamBytes": model_bytes,
            "requiredRamBytes": model_bytes + policy["marginBytes"],
            "requiredDiskBytes": 704 + voxels * 5 + 128 * MIB,
            "maxRssBytes": min(HARD_RSS_LIMIT, model_bytes + 128 * MIB),
            "systemReserveBytes": SYSTEM_RESERVE,
            "threads": policy["threads"], "interOpThreads": policy["interOpThreads"]}


def preflight(dimensions, frame_count, available_ram, free_disk, profile="safe", stored_input_bytes=0, full_stream=False):
    result = estimate_resources(dimensions, frame_count, profile, full_stream)
    if type(stored_input_bytes) is not int or not 0 <= stored_input_bytes <= 352 + prod(dimensions) * 4:
        raise ValueError("invalid_stored_input_size")
    # A second check must not reserve disk for the already stored upload twice.
    result["requiredDiskBytes"] -= stored_input_bytes
    result.update(availableRamBytes=max(0, int(available_ram)), availableDiskBytes=max(0, int(free_disk)))
    if result["estimatedModelRamBytes"] + 128 * MIB > HARD_RSS_LIMIT:
        decision = "reject-model-budget"
    elif result["availableRamBytes"] < result["requiredRamBytes"]:
        decision = "reject-memory"
    elif result["availableDiskBytes"] < result["requiredDiskBytes"]:
        decision = "reject-disk"
    else:
        decision = "allow"
    result["guardDecision"] = decision
    return result
