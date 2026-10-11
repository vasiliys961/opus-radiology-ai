"""Conservative local CPU estimates, not an M1/system-memory acceptance claim."""
from math import prod

MIB = 1024**2
HARD_RSS_LIMIT = 2 * 1024**3
SYSTEM_RESERVE = 256 * MIB
PROFILES = {
    "safe": {"threads": 1, "interOpThreads": 1, "bytesPerVoxel": 24, "marginBytes": 384 * MIB},
    "balanced": {"threads": 2, "interOpThreads": 1, "bytesPerVoxel": 32, "marginBytes": 512 * MIB},
}


def estimate_resources(dimensions, frame_count, profile="safe"):
    if profile not in PROFILES:
        raise ValueError("unsupported_resource_profile")
    if (len(dimensions) != 3 or any(type(n) is not int or n < 1 for n in dimensions)
            or type(frame_count) is not int or frame_count != dimensions[2]):
        raise ValueError("invalid_resource_geometry")
    voxels = prod(dimensions)
    if voxels > 8_388_608:
        raise ValueError("voxel_limit")
    policy = PROFILES[profile]
    # Fixed Torch/net/workspace allowance, full-volume copies/postprocessing,
    # and 256x256 per-frame intermediates in pinned Lungmask 0.2.20.
    # These coefficients are provisional and require native M1 calibration.
    model_bytes = 896 * MIB + voxels * policy["bytesPerVoxel"] + frame_count * 256 * 256 * 12
    return {"profile": profile, "estimatedModelRamBytes": model_bytes,
            "requiredRamBytes": model_bytes + policy["marginBytes"],
            "requiredDiskBytes": 704 + voxels * 5 + 128 * MIB,
            "maxRssBytes": min(HARD_RSS_LIMIT, model_bytes + 128 * MIB),
            "systemReserveBytes": SYSTEM_RESERVE,
            "threads": policy["threads"], "interOpThreads": policy["interOpThreads"]}


def preflight(dimensions, frame_count, available_ram, free_disk, profile="safe", stored_input_bytes=0):
    result = estimate_resources(dimensions, frame_count, profile)
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
