#!/usr/bin/env python3
"""Opt-in REAL TotalSegmentator task-315 -> native CT research Evidence.

Works ONLY with already-installed official pretrained weights on an isolated,
adequately provisioned Linux CPU research host. Never a patient-mode service.
Pretrained performance is NOT clinically validated. No empty-mask negatives.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import re
import time

from effusion_source_evidence import run as inspect_effusion, digest
from totalsegmentator_input import inspect_input

TASK = "pleural_pericard_effusion"
PINNED_VERSION = "2.18.0"
AUTH = "PUBLIC-CT-RESEARCH-TASK315-OK"
MIN_FREE_RAM_BYTES = 10 * 1024**3
MAX_WEIGHT_BYTES = 1024**3

def checked_path(source, target, report, checkpoint):
    """Fail before importing torch or touching large model weights."""
    s, t, r, w = map(Path, (source, target, report, checkpoint))
    if (s.is_symlink() or not s.is_file() or s.suffix != ".nii"
        or w.is_symlink() or not w.is_file() or
        w.stat().st_size <= 1024 or w.stat().st_size > MAX_WEIGHT_BYTES
        or not w.name.endswith((".pth", ".pt"))):
        raise ValueError("invalid_research_source_or_weights")
    if (t.suffix not in (".nii", ".gz") or not t.name.endswith((".nii", ".nii.gz")) or
        r.suffix != ".json" or
        t.exists() or r.exists() or t.is_symlink() or r.is_symlink()
        or t.parent.resolve() != r.parent.resolve() or not t.parent.is_dir()):
        raise ValueError("output_paths_must_be_new")
    if len({s.resolve(), t.resolve(), r.resolve(), w.resolve()}) != 4:
        raise ValueError("source_mask_report_weights_paths_must_differ")
    return s, t, r, w

def research_source_admission(source, sha, manifest_path):
    mpath = Path(manifest_path)
    if mpath.is_symlink() or not mpath.is_file() or mpath.stat().st_size > 4096:
        raise ValueError("invalid_research_source_admission")
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    if (not isinstance(manifest, dict) or
        manifest.get("schema") != "opus-public-ct-task315-admission/v1" or
        manifest.get("sourceSha256") != sha or
        manifest.get("modality") != "CT" or
        manifest.get("pixelIntensity") != "verified-original-HU" or
        manifest.get("fullAcquisitionCoverageVerified") is not True or
        manifest.get("publicOrRightsClearedResearchData") is not True or
        manifest.get("notRealPatientData") is not True or
        manifest.get("originalImageLicenseReviewed") is not True):
        raise ValueError("not_authorized_or_unverified_source_ct")
    # This is researcher attestation, NOT independently audited rights or HU.
    return manifest

def run(source, output_mask, output_json, checkpoint_path, checkpoint_sha,
        admission_file, authorization, *, inference=None, available_ram_bytes=None,
        runtime_version=None):
    if authorization != AUTH:
        raise ValueError("explicit_research_authorization_required")
    source, mask, report, weights = checked_path(source, output_mask, output_json, checkpoint_path)
    dimensions = inspect_input(source)["dimensions"]
    sha = digest(source)
    research_source_admission(source, sha, admission_file)
    if (not isinstance(checkpoint_sha, str) or
        not re.fullmatch(r"[a-f0-9]{64}", checkpoint_sha) or
        digest(weights) != checkpoint_sha):
        raise ValueError("pretrained_checkpoint_digest_mismatch")
    # CPU host admission; M1/8GB must not be used for heavy inference.
    if inference is None:
        if platform.system() != "Linux":
            raise ValueError("isolated_linux_cpu_research_host_required")
        import psutil
        available = psutil.virtual_memory().available
        version = importlib.metadata.version("TotalSegmentator")
    else:
        # Mockable ONLY in technical tests. Never report mocked runs as genuine.
        available = available_ram_bytes
        version = runtime_version
    if version != PINNED_VERSION or not isinstance(available, int) or available < MIN_FREE_RAM_BYTES:
        raise ValueError("totalseg_version_or_safe_ram_unavailable")
    if inference is None:
        # The caller MUST place this process in an OS-level network-isolated
        # container with preprovisioned weights and a memory/cgroup limit.
        from totalsegmentator.python_api import totalsegmentator
        inference = totalsegmentator
    start = time.monotonic()
    try:
        # The real pretrained task, NOT default anatomical 'total' and NOT a
        # mask constructed by Opus. ml=True requests one native multilabel NIfTI.
        inference(input=source, output=mask, task=TASK,
                  ml=True, device="cpu", quiet=True)
        if mask.is_symlink() or not mask.is_file():
            raise ValueError("trained_task315_output_missing")
        evidence = inspect_effusion(source, mask, sha, checkpoint_sha,
             "PUBLIC-OR-AUTHORIZED-CHEST-CT-RESEARCH-OK")
        # A digest on a supplied path DOES NOT independently prove the vendor
        # loaded that exact checkpoint from its cache. Report accordingly.
        result = {
           "schema":"opus-real-task315-effusion-execution/v1",
           "task":TASK, "requestedDevice":"cpu",
           "actualPretrainedInferenceClaimed":inference is not None and available_ram_bytes is None,
           "runMode":"isolated-author-installed" if available_ram_bytes is None else "technical-fixture",
           "modelPackageVersion":version,
           "observedInstalledWeightFileSha256":checkpoint_sha,
           "activeWeightsCryptographicallyProven":False,
           "sourceNiftiSha256":sha,
           "maskSha256":digest(mask),
           "sourceDimensions":list(dimensions),
           "elapsedSeconds":round(time.monotonic()-start,3),
           "evidence":evidence,
           "clinicalStatus":"unverified_research_draft",
           "negativeDiagnosisPermitted":False,
           "limitations":[
             "Research operator source/HU/license attestations are not independent proof.",
             "Checkpoint-file SHA does not prove the same file was loaded by the vendor.",
             "No independent sensitivity, specificity or clinical diagnosis.",
             "A zero pleural or pericardial mask never rules out effusion.",
           ]
        }
        report.write_text(json.dumps(result,indent=2),encoding="utf-8")
        return result
    except BaseException:
        # Never leave a misleading complete model report on failure.
        report.unlink(missing_ok=True)
        if mask.is_file() and not mask.is_symlink():
            mask.unlink()
        raise

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("source","output-mask","output-json","checkpoint","checkpoint-sha256",
                 "source-admission","authorization"):
        p.add_argument("--"+name, required=True)
    a = p.parse_args(argv)
    result=run(a.source,a.output_mask,a.output_json,a.checkpoint,
               a.checkpoint_sha256,a.source_admission,a.authorization)
    print(json.dumps({"status":"research-only","task":TASK,
                      "maskSha256":result["maskSha256"],
                      "evidenceJson":a.output_json,
                      "clinicalValidation":False}))
    return 0

if __name__=="__main__":
    raise SystemExit(main())
