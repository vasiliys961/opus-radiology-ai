"""Safe warm-start of finding-v2 weights from an earlier gold-only checkpoint.

Unlike --resume, warm-start creates a FRESH optimizer and epoch counter and
may be used with a new reviewed-label training manifest. Research only.
"""
from rsna_knee import LABELS

EXPECTED_MODEL = "dinov2-small-finding-mil-v2"
EXPECTED_ENCODER = "facebook/dinov2-small:frozen-v1"
GEOMETRY = ("slices", "series_limit", "pixel_mode", "slice_order", "series_selection")


def validate_warmstart(checkpoint, args):
    if checkpoint.get("model") != EXPECTED_MODEL:
        raise ValueError("Warm-start requires finding-v2 checkpoint")
    if checkpoint.get("head_family") != "finding-v2":
        raise ValueError("Wrong finding head family")
    if checkpoint.get("encoder_id") != EXPECTED_ENCODER:
        raise ValueError("Unsupported encoder weights")
    if checkpoint.get("labels") != list(LABELS):
        raise ValueError("12-label order or ontology mismatch")
    for field in GEOMETRY:
        if checkpoint.get(field) != getattr(args, field):
            raise ValueError("Warm-start geometry mismatch: " + field)
    if not isinstance(checkpoint.get("state_dict"), dict):
        raise ValueError("Missing model state dictionary")
    if not isinstance(checkpoint.get("head_state_dict"), dict):
        raise ValueError("Missing pathology-specific head weights")
    if not checkpoint["state_dict"] or not checkpoint["head_state_dict"]:
        raise ValueError("Empty checkpoint weights")
    return {"source_epoch": checkpoint.get("epoch"),
            "model": checkpoint["model"],
            "fresh_optimizer": True,
            "new_training_run": True}
