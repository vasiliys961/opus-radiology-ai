#!/usr/bin/env python3
"""Download/audit original MS3SEG four-class pretrained FLAIR U-Net weights.

Actual original bytes, never fabricated or trained here. Does NOT load/pickle
model, run inference, diagnose multiple sclerosis or export patient images.
No cloud patient data. Original CC BY 4.0 author asset, isolated Linux CI.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

MODEL_ID = "Bawil/MS3SEG"
REVISION = "630ff655e120b1125c429aebad475899aa6aa8af"
AUTHOR_PATH = (
    "kfold_brain_segmentation_20250924_232752_unified_focal_loss/"
    "models/multi_class/u_net_fold_4_best.h5"
)
MAX_BYTES = 600 * 1024**2
MIN_BYTES = 20 * 1024**2
TARGETS = ("background", "ventricles", "normal_white_matter_hyperintensities",
           "abnormal_white_matter_hyperintensities_MS_clearly_not_diagnosis")


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def inspect_original_keras_h5(path):
    """Pure non-executing HDF5 JSON audit, no TensorFlow model/pickle load."""
    import h5py
    if not MIN_BYTES < path.stat().st_size < MAX_BYTES:
        raise ValueError("original publisher multi-class model outside bounded size")
    with h5py.File(path, "r") as f:
        raw = f.attrs.get("model_config")
        if raw is None:
            raise ValueError("publisher H5 lacks Keras serialized architecture")
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        if not isinstance(raw, str) or len(raw) > 12_000_000:
            raise ValueError("invalid original H5 model_config")
        model = json.loads(raw)
    config = model.get("config")
    if not isinstance(config, dict) or not isinstance(config.get("layers"), list):
        raise ValueError("not a complete author Keras functional model")
    layers = config["layers"]
    if len(layers) < 4 or len(layers) > 5000:
        raise ValueError("unrecognized author model architecture")
    inputs = [x.get("config", {}) for x in layers if x.get("class_name") == "InputLayer"]
    if len(inputs) != 1:
        raise ValueError("expect one input channel for author axial brain FLAIR")
    shape = inputs[0].get("batch_shape", inputs[0].get("batch_input_shape"))
    if (not isinstance(shape, list) or len(shape) != 4 or
            shape[1:4] != [256, 256, 1]):
        raise ValueError("original four-class model input not 256x256x1 FLAIR")
    convolutions = [x for x in layers if x.get("class_name") == "Conv2D"]
    if not convolutions or convolutions[-1].get("config", {}).get("filters") != 4:
        raise ValueError("last original U-Net convolution does not have four output classes")
    return {"modelInputShape": shape, "lastConvFilterCount": 4,
            "originalModelConfigSha256": hashlib.sha256(raw.encode()).hexdigest(),
            "sourceDocumentedClassOrder": list(TARGETS)}


def audit(output, execute):
    if not execute:
        return {"schema": "opus-ms3seg-4class-author-model-byte-audit/v1",
                "checkpointDownloaded": False, "actualOriginalForward": False,
                "clinicallyValidated": False}
    from huggingface_hub import HfApi, hf_hub_download
    info = HfApi(token=False).model_info(MODEL_ID, revision=REVISION, token=False)
    if info.sha != REVISION or len(REVISION) != 40:
        raise ValueError("publisher model commit differs from author revision")
    filenames = [item.rfilename for item in info.siblings]
    if filenames.count(AUTHOR_PATH) != 1:
        raise ValueError("one exact original published U-Net multi-class checkpoint required")
    path = Path(hf_hub_download(repo_id=MODEL_ID, filename=AUTHOR_PATH,
                                revision=REVISION, token=False))
    ontology = inspect_original_keras_h5(path)
    report = {
        "schema": "opus-ms3seg-4class-author-model-byte-audit/v1",
        "originalPublisher": MODEL_ID,
        "authorHFRevisionSha": REVISION,
        "originalPretrainedCheckpointRelativePath": AUTHOR_PATH,
        "actualOriginalCheckpointBytes": path.stat().st_size,
        "actualOriginalCheckpointSha256": sha256(path),
        **ontology,
        "originalPublication": "MS3SEG Scientific Data 2026 10.1038/s41597-026-07184-5",
        "modelLicensePublisherClaim": "CC BY 4.0, verify provenance before commercial patient use",
        "underlyingModality": "skull-stripped normalized 256x256 axial T2-FLAIR",
        "modelTrainedOnOwnMS3SEGPatients": True,
        "trainingOverlapExcluded": False,
        "actualOriginalForward": False,
        "matchedExpertSourceFound": False,
        "clinicalDiagnosisPermitted": False,
        "clinicallyValidated": False,
        "originalImagesMasksOrWeightsInArtifact": False,
    }
    if output.exists() or output.is_symlink() or not output.parent.is_dir():
        raise ValueError("fresh numeric JSON output path required")
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--numeric-report", required=True, type=Path)
    p.add_argument("--execute-download-original", action="store_true")
    a = p.parse_args()
    try:
        result = audit(a.numeric_report, a.execute_download_original)
        print(json.dumps(result, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, ImportError, KeyError, TypeError) as exc:
        print("MS3SEG genuine weight verification rejected: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
