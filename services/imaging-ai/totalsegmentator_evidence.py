"""Fail-closed TotalSegmentator result-to-Evidence handoff. Does not run models."""
from totalsegmentator_audit import LUNG_LOBES, plan
from totalsegmentator_result import validate_native_mask

def prepare_evidence(mask_path, dimensions, affine_lps, source_sha, installed_audit,
                     expected_checkpoint_sha, selected_roi=None):
    """Trust neither a downloaded model nor an arbitrary unsigned mask."""
    reject = lambda why: {"accepted": False, "reason": why, "clinicalStatus": "unverified_research_draft"}
    task = plan("CT", roi=selected_roi)
    if not isinstance(installed_audit, dict):
        return reject("missing_install_audit")
    if installed_audit.get("schema") != "opus-totalsegmentator-install-audit/v1":
        return reject("invalid_install_audit")
    # Existing audit never proves provenance or permission, even when all six files exist.
    if installed_audit.get("canRun") is not False or installed_audit.get("adapterConnected") is not False:
        return reject("invalid_audit_state")
    if (not isinstance(expected_checkpoint_sha, str) or len(expected_checkpoint_sha) != 64 or
            any(c not in "0123456789abcdef" for c in expected_checkpoint_sha)):
        return reject("unverified_checkpoint")
    files = installed_audit.get("files")
    if not isinstance(files, list) or len(files) != 6:
        return reject("missing_required_assets")
    checkpoints = [f for f in files if isinstance(f, dict) and f.get("file", "").endswith("/fold_0/checkpoint_final.pth")]
    if len(checkpoints) != 2 or any(f.get("status") != "present-unverified" for f in checkpoints):
        return reject("missing_required_assets")
    # Independently curated hashes and licensing are not in this interface yet.
    # Never convert a local SHA or caller-supplied digest into trusted origin.
    return reject("independent_provenance_not_connected")


def inspect_research_mask(mask_path, dimensions, affine_lps, source_sha, roi=None):
    """Inspection-only: permit analysis of a synthetic/public mask, not model readiness."""
    task = plan("CT", roi=roi)
    selected = [label["id"] for label in task["labels"]]
    result = validate_native_mask(mask_path, dimensions, affine_lps, source_sha, selected)
    return {"schema": "opus-totalsegmentator-mask-inspection/v1",
            "model": {"id": "TotalSegmentator", "version": task["packageVersion"],
                      "task": task["task"], "fast": task["fast"],
                      "checkpointVerified": False, "executed": False},
            "result": result, "allowedLabels": task["labels"],
            "readyForClinicalUse": False, "readyForMprImport": False}
