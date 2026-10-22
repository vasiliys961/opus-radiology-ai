"""Persistable, fail-closed detector enablement profiles.

These controls govern eligibility only; they DO NOT launch inference or upload
patient images. A clinical report must distinguish not-run from negative.
"""
from dataclasses import dataclass

STATES = {"auto", "on_demand", "disabled", "archived"}
PROFILES = {
    "economy": {"lung_nodules": "on_demand", "pleural_effusion": "on_demand",
                "compai_lnq_model7": "archived", "lungscape191": "archived",
                "nih_bone_lesions": "archived"},
    "clinical": {"lung_nodules": "auto", "pleural_effusion": "auto",
                 "compai_lnq_model7": "on_demand", "lungscape191": "on_demand",
                 "nih_bone_lesions": "on_demand"},
    "research": {"lung_nodules": "auto", "pleural_effusion": "auto",
                 "compai_lnq_model7": "on_demand", "lungscape191": "on_demand",
                 "nih_bone_lesions": "on_demand"},
}
# Only source-verified, explicitly approved clinical validation may turn
# an automatic candidate into a clinically routed detector.
CLINICALLY_APPROVED = frozenset()

@dataclass(frozen=True)
class Gate:
    detector: str
    configured_state: str
    may_autorun: bool
    may_manual_run: bool
    may_load_weights: bool
    result_state: str
    reason: str

def resolve_gate(*, detector, profile="economy", overrides=None,
                 manually_requested=False, research_authorized=False):
    if profile not in PROFILES:
        raise ValueError("unknown_profile")
    if detector not in PROFILES[profile]:
        raise ValueError("unknown_detector")
    overrides = overrides or {}
    if not isinstance(overrides, dict) or any(k not in PROFILES[profile] or v not in STATES for k,v in overrides.items()):
        raise ValueError("invalid_detector_state_override")
    state = overrides.get(detector, PROFILES[profile][detector])
    if state in ("disabled", "archived"):
        return Gate(detector, state, False, False, False, "not_run", "disabled_or_archived")
    # Models without independent validation are opt-in research only, never
    # silently activated for patient-facing clinical interpretation.
    approved = detector in CLINICALLY_APPROVED
    if not approved and not research_authorized:
        return Gate(detector, state, False, False, False, "not_run", "research_authorization_required")
    auto = bool(state == "auto" and approved)
    manual = bool(manually_requested and state in ("auto", "on_demand"))
    eligible = auto or manual
    return Gate(detector, state, auto, manual, eligible, "pending" if eligible else "not_run",
                "admitted_to_independent_resource_and_privacy_checks" if eligible else "not_requested")

if __name__ == "__main__":
    for profile in PROFILES:
        assert not resolve_gate(detector="lungscape191", profile=profile).may_load_weights
        assert resolve_gate(detector="lungscape191", profile=profile).result_state == "not_run"
    assert resolve_gate(detector="lungscape191",profile="research",manually_requested=True,research_authorized=True).may_manual_run
    assert not resolve_gate(detector="lungscape191",profile="research",overrides={"lungscape191":"disabled"},manually_requested=True,research_authorized=True).may_load_weights
    assert not resolve_gate(detector="lungscape191",profile="research",overrides={"lungscape191":"archived"},manually_requested=True,research_authorized=True).may_load_weights
    print("PASS: detector profiles never fabricate a negative finding")
