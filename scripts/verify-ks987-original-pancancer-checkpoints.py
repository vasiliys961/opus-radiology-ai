#!/usr/bin/env python3
"""Actually hash publicly licensed publisher KS987 site-specific pretrained bytes.

Only official original Hugging Face repository, read-only, pinned full commit.
No CT, no patient data, no torch.load/pickle execution, no model inference.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

MODEL = "KS987/PanCancerSeg-Specialized-weights"
TRAINER = "nnUNetTrainerWandb2000__nnUNetResEncUNetMPlans__3d_fullres"
TASKS = {"lung": "Dataset105_Lung", "kidney": "Dataset102_Kidney"}
SHA = re.compile(r"^[0-9a-f]{40}$")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(2**20), b""):
            h.update(chunk)
    return h.hexdigest()


def select_files(names, target):
    prefix = TASKS[target] + "/"
    suffixes = {
        "weights": "/fold_0/checkpoint_best.pth",
        "dataset": "/dataset.json",
        "plans": "/plans.json",
    }
    paths = {}
    for key, suffix in suffixes.items():
        matches = [name for name in names if name.startswith(prefix)
                   and name.endswith(suffix) and "/" + TRAINER + "/" in name]
        if len(matches) != 1:
            raise ValueError("publisher original " + target + " " + key
                             + " path not uniquely available: " + str(matches[:4]))
        paths[key] = matches[0]
    return paths


def audit(target, *, output, execute):
    if target not in TASKS:
        raise ValueError("unsupported cancer target")
    if not execute:
        return {"model": MODEL, "target": target,
                "originalWeightsDownloaded": False,
                "actualOriginalForward": False, "clinicalValidation": False}
    from huggingface_hub import HfApi, hf_hub_download
    model_info = HfApi(token=False).model_info(MODEL, token=False)
    revision = model_info.sha
    if not SHA.fullmatch(revision):
        raise ValueError("official HF git revision not a stable full commit")
    names = [s.rfilename for s in model_info.siblings]
    selected = select_files(names, target)
    paths = {}
    for key, remote_path in selected.items():
        paths[key] = Path(hf_hub_download(
            repo_id=MODEL, revision=revision, filename=remote_path, token=False))
    size = paths["weights"].stat().st_size
    if not 10 * 1024**2 <= size <= 3 * 1024**3:
        raise ValueError("original trained checkpoint outside bounded size")
    j = json.loads(paths["dataset"].read_text(encoding="utf8"))
    labels = j.get("labels")
    if (not isinstance(labels, dict) or len(labels) != 2 or
            labels.get("background") != 0 or
            set(labels.values()) != {0, 1} or
            j.get("file_ending") != ".nii.gz" or
            not isinstance(j.get("channel_names"), dict) or
            len(j["channel_names"]) != 1):
        raise ValueError("original trainer-specific binary tumor ontology not confirmed")
    p = json.loads(paths["plans"].read_text(encoding="utf8"))
    if p.get("plans_name") != "nnUNetResEncUNetMPlans":
        raise ValueError("not original ResEnc medium nnU-Net plans")
    record = {
        "schema": "opus-pancancer-actual-original-weight-bytes/v1",
        "modelRepository": MODEL,
        "publisherRevisionSha": revision,
        "originalPublisherLicenseClaim": "Apache-2.0 in original model card",
        "target": target,
        "originalFold0CheckpointByteSize": size,
        "originalFiles": {
            key: {"publisherRelativePath": selected[key],
                  "actualDownloadedSha256": digest(paths[key])}
            for key in ("weights", "dataset", "plans")
        },
        "originalModelOntology": labels,
        "actualPublicPretrainedWeightBytesDownloadedAndHashed": True,
        "originalCheckpointLoadedAsModel": False,
        "actualOriginalForward": False,
        "expertPositivesEvaluated": 0,
        "independentValidation": False,
        "medicalPatientUse": False,
        "researchOnly": True,
    }
    output = Path(output)
    if output.exists() or not output.parent.is_dir():
        raise ValueError("numeric output path must be fresh")
    output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    return record


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--target", choices=sorted(TASKS), required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--execute-download-original-public-weights", action="store_true")
    a = p.parse_args()
    try:
        j = audit(a.target, output=a.output, execute=a.execute_download_original_public_weights)
        print(json.dumps(j, indent=2))
        return 0
    except (OSError, ValueError, RuntimeError, ImportError) as exc:
        print("original trained publisher weight verification failed: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
