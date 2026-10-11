"""Resource policy units; coefficients remain provisional until M1 measurement."""
import pytest

from resource_guard import MIB, HARD_RSS_LIMIT, estimate_resources, preflight


def test_native_reference_safe_budget_is_below_old_fixed_gate():
    p = estimate_resources([512, 512, 32], 32)
    assert p["requiredRamBytes"] == 1219 * MIB
    assert p["maxRssBytes"] == 963 * MIB
    assert p["requiredRamBytes"] > p["maxRssBytes"] + p["systemReserveBytes"] - 1
    assert p["requiredRamBytes"] < 2 * 1024**3
    assert p["threads"] == p["interOpThreads"] == 1


def test_reported_mac_memory_admits_streamed_pipeline_without_lowering_reserve():
    # Actual failed Mac admission: 1318.625 MiB. This is a calculator/admission
    # regression, NOT a claim that this Mac has completed the new inference.
    p = preflight([512, 512, 32], 32, 1_382_678_528, 32_950_009_856)
    assert p["guardDecision"] == "allow"
    assert p["requiredRamBytes"] - p["estimatedModelRamBytes"] == 384 * MIB
    assert p["systemReserveBytes"] == 256 * MIB
    # Geometry still matters even for equal voxel counts: a larger single
    # native plane requires a larger temporary workspace.
    a = estimate_resources([512, 512, 32], 32)
    b = estimate_resources([1024, 512, 16], 16)
    assert a["requiredRamBytes"] != b["requiredRamBytes"]


def test_volume_and_frame_workspaces_are_counted_separately():
    small = estimate_resources([128, 128, 8], 8)
    large = estimate_resources([256, 256, 8], 8)
    many_frames = estimate_resources([128, 64, 16], 16)
    assert small["requiredRamBytes"] < large["requiredRamBytes"]
    assert small["requiredRamBytes"] < many_frames["requiredRamBytes"]
    assert estimate_resources([512, 512, 32], 32, "balanced")["requiredRamBytes"] > estimate_resources([512, 512, 32], 32)["requiredRamBytes"]


def test_ram_disk_exact_boundaries_and_absolute_model_budget():
    p = estimate_resources([512, 512, 32], 32)
    assert preflight([512,512,32], 32, p["requiredRamBytes"], p["requiredDiskBytes"])["guardDecision"] == "allow"
    assert preflight([512,512,32], 32, p["requiredRamBytes"]-1, p["requiredDiskBytes"])["guardDecision"] == "reject-memory"
    assert preflight([512,512,32], 32, p["requiredRamBytes"], p["requiredDiskBytes"]-1)["guardDecision"] == "reject-disk"
    # Many tiny slices fit the voxel cap but not Lungmask's per-frame workspace.
    p = preflight([16,16,4096], 4096, 100 * 1024**3, 100 * 1024**3)
    assert p["guardDecision"] == "reject-model-budget"
    assert p["maxRssBytes"] == HARD_RSS_LIMIT


def test_second_disk_check_counts_existing_upload_once():
    p = estimate_resources([512,512,32], 32)
    stored = 352 + 512 * 512 * 32 * 4
    d = preflight([512,512,32], 32, p["requiredRamBytes"], p["requiredDiskBytes"]-stored, stored_input_bytes=stored)
    assert d["guardDecision"] == "allow"
    assert d["requiredDiskBytes"] == p["requiredDiskBytes"]-stored
    with pytest.raises(ValueError):
        preflight([512,512,32], 32, p["requiredRamBytes"], p["requiredDiskBytes"], stored_input_bytes=stored+1)


@pytest.mark.parametrize("dims,frames,profile", [([0,2,3],3,"safe"), ([2,3,4],3,"safe"),
    ([512,512,33],33,"safe"), ([2,3,4],4,"unknown"), ([True,2,3],3,"safe")])
def test_invalid_inputs_never_lower_the_budget(dims, frames, profile):
    with pytest.raises(ValueError):
        estimate_resources(dims, frames, profile)
