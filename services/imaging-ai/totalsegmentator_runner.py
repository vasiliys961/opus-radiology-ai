"""Opt-in research TotalSegmentator bridge; not connected to browser or clinical worker."""
import importlib
from pathlib import Path
from totalsegmentator_audit import plan
from totalsegmentator_result import validate_native_mask

class ModelUnavailable(RuntimeError):
    pass

def execute_research_ct(input_nii, output_nii, dimensions, affine_lps, source_sha,
                        *, authorization=None, resource_decision=None, roi=None, infer=None):
    """Caller must provide separately verified OS isolation, license and model evidence."""
    p = plan("CT", roi=roi)
    required = ("research_only", "source_permitted", "weights_verified",
                "license_reviewed", "network_isolated", "worker_isolated")
    if not isinstance(authorization, dict) or not all(
            authorization.get(k) is True for k in required):
        raise ModelUnavailable("research_authorization_incomplete")
    if (not isinstance(resource_decision, dict) or
            resource_decision.get("canAdmit") is not True or
            resource_decision.get("reason") != "measured_budget_only"):
        raise ModelUnavailable("resource_preflight_rejected")
    source, target = Path(input_nii), Path(output_nii)
    if (source.is_symlink() or not source.is_file() or target.exists()
            or target.is_symlink() or source.resolve() == target.resolve()):
        raise ModelUnavailable("invalid_input_output_paths")
    if infer is None:
        # No official checkpoint provenance / OS network isolation yet; no real
        # execution until a trusted process launcher provides these guarantees.
        raise ModelUnavailable("isolated_execution_not_connected")
    try:
        infer(input=source, output=target, task="total", fast=True,
              roi_subset=p["roiSubset"], device="cpu", quiet=True)
        if target.is_symlink() or not target.is_file():
            raise ModelUnavailable("missing_native_mask")
        result = validate_native_mask(target, dimensions, affine_lps, source_sha,
                                      [label["id"] for label in p["labels"]])
        return {"schema": "opus-totalsegmentator-research-run/v1",
                "model": "TotalSegmentator", "task": "total", "fast": True,
                "device": "cpu", "result": result,
                "clinicalStatus": "unverified_research_draft",
                "readyForClinicalUse": False, "readyForMprImport": False}
    except Exception:
        if target.exists() and target.is_file() and not target.is_symlink():
            target.unlink()
        raise
