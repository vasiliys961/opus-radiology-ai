#!/usr/bin/env python3
"""Run original Lab-Rasool CLN weights against real expert-positive MSD lung CT.

One public, source-pinned case; CPU only; artifacts contain numeric measurements
only. This source participated in the MSD dataset and is NOT independent.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

DATASET = "MedOtter/msd-lung"
CASE = "lung_043.nii.gz"
IM = "imagesTr/" + CASE
GT = "labelsTr/" + CASE
MAX_CT_BYTES = 300 * 1024**2


def load_cln():
    p = Path(__file__).with_name("cln-msd-original-ct-cpu.py")
    spec = importlib.util.spec_from_file_location("cln_real_cpu", p)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def get_public_case(work: Path) -> dict:
    from huggingface_hub import dataset_info, hf_hub_download
    import nibabel as nib
    import numpy as np

    work.mkdir(parents=True, exist_ok=True)
    data = dataset_info(DATASET, files_metadata=True, token=False)
    if not data.sha or len(data.sha) != 40:
        raise ValueError("unversioned_original_MSD_public_mirror")
    siblings = {s.rfilename: s for s in data.siblings}
    if IM not in siblings or GT not in siblings:
        raise ValueError("public_MSD_CT_or_expert_mask_not_published")
    mod = load_cln()
    saved = {}
    for name, key in ((IM, "ct"), (GT, "expert")):
        source_meta = siblings[name]
        if source_meta.size and source_meta.size > MAX_CT_BYTES:
            raise ValueError("public_original_CT_or_mask_too_large")
        filepath = Path(hf_hub_download(repo_id=DATASET, repo_type="dataset",
                                        filename=name, revision=data.sha, token=False))
        if filepath.stat().st_size > MAX_CT_BYTES:
            raise ValueError("public_MSD_source_exceeds_limit")
        digest = mod.sha256(filepath)
        if source_meta.lfs and source_meta.lfs.get("sha256") and digest != source_meta.lfs["sha256"]:
            raise ValueError("public_MSD_file_does_not_match_publisher_SHA256")
        saved[key] = filepath
        saved[key + "SHA256"] = digest
    ct = nib.load(str(saved["ct"]))
    gt = nib.load(str(saved["expert"]))
    if (ct.shape != gt.shape or len(ct.shape) != 3 or
            not np.allclose(ct.affine, gt.affine, rtol=0, atol=0.02) or
            np.prod(ct.shape, dtype=np.int64) > 200_000_000):
        raise ValueError("public_expert_mask_not_native_CT_grid")
    positive = 0
    for start in range(0, ct.shape[2], 8):
        vol = np.asarray(gt.dataobj[:, :, start:start+8])
        if not np.isfinite(vol).all() or not np.isin(vol, (0, 1)).all():
            raise ValueError("original_MSD_tumor_labels_not_binary")
        positive += int(np.count_nonzero(vol))
    if positive == 0:
        raise ValueError("public_selected_CT_has_no_expert_tumor")
    return {"dataset": DATASET, "revision": data.sha, "case": CASE,
            "ct": saved["ct"], "expert": saved["expert"],
            "ctSHA256": saved["ctSHA256"], "expertSHA256": saved["expertSHA256"],
            "expertPositiveVoxels": positive,
            "independentFromModelTraining": False, "sourceLicense": "cc-by-sa-4.0"}


def run(work: Path, mode: str, memory_gib: float, timeout_sec: int) -> dict:
    mod = load_cln()
    source = get_public_case(work)
    report = {"schema": "opus-cln-MSD-public-CT-positive-reference/v1",
              "dataset": source["dataset"], "datasetRevision": source["revision"],
              "sourceCTSHA256": source["ctSHA256"], "expertMaskSHA256": source["expertSHA256"],
              "expertPositiveVoxels": source["expertPositiveVoxels"],
              "caseCount": 1, "gpuUsed": False, "patientCloudTransfer": False,
              "independentValidation": False, "clinicallyValidated": False,
              "realOriginalModelForwardCompleted": False}
    if mode == "source":
        return report
    modelroot = work/"models"
    manifest = mod.provision(modelroot/mod.TASK/mod.TRAINER)
    report.update({"originalPublisherModelSHA256": manifest["checkpointSHA256"],
                   "originalPublisherWeightsVerified": True})
    from argparse import Namespace
    args = Namespace(approved_public_source=True, ct=source["ct"],
                     source_sha256=source["ctSHA256"], model_dir=modelroot,
                     checkpoint_sha256=manifest["checkpointSHA256"],
                     output=work/"output", expert=source["expert"],
                     memory_gib=memory_gib, timeout_sec=timeout_sec)
    evidence = mod.infer(args)
    report.update(evidence)
    report["independentValidation"] = False
    report["clinicallyValidated"] = False
    return report


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=("source", "infer"), required=True)
    p.add_argument("--workdir", type=Path, required=True)
    p.add_argument("--report", type=Path, required=True)
    p.add_argument("--memory-gib", type=float, default=6)
    p.add_argument("--timeout-sec", type=int, default=1700)
    args = p.parse_args()
    try:
        summary = run(args.workdir, args.mode, args.memory_gib, args.timeout_sec)
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps({"realForward": summary["realOriginalModelForwardCompleted"],
                          "originalCTSHA256": summary["sourceCTSHA256"],
                          "Dice": summary.get("voxelDice"),
                          "expertPositiveVoxels": summary["expertPositiveVoxels"],
                          "independentValidation": False}))
    except Exception as err:
        raise SystemExit("CLN_ORIGINAL_MSD_REAL_CT_NOT_CONFIRMED: " + str(err))


if __name__ == "__main__":
    main()
