#!/usr/bin/env python3
"""Preflight genuine pinned SAMIHS CPU inference BEFORE downloading any CT.

An authorized, disposable GitHub runner runs the REAL verified model on one
generated 256x256x1 nonpatient NIfTI and validates a geometrically bound binary
output. This is NOT a clinical case, Dice score or real-study validation.
The vendor log stays private and only typed errors reach public Actions.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile

def diagnostic_module():
    path = Path(__file__).with_name("run-ich-samihs-cpu-pilot.py")
    spec = importlib.util.spec_from_file_location("opus_ich_private_error_types", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_smoke(model_dir: Path, wrapper_sha256: str, timeout_seconds: int) -> None:
    if (sys.platform != "linux" or os.environ.get("ALLOW_UPSTREAM_PICKLE") != "true"
            or not 60 <= timeout_seconds <= 900):
        raise ValueError("explicit_authorized_bounded_linux_cpu_smoke_required")
    import nibabel as nib
    import numpy as np

    with tempfile.TemporaryDirectory(prefix="opus-public-no-patient-cpu-smoke-") as td:
        private = Path(td)
        # Deterministic invented pixel values, never obtained from a patient.
        y, x = np.indices((256, 256))
        values = (0.55 * x + 0.45 * y).astype(np.float32)[:, :, None]
        affine = np.diag([0.8, 0.8, 2.5, 1.0])
        generated = nib.Nifti1Image(values, affine)
        generated.header.set_xyzt_units(xyz="mm")
        generated.set_qform(affine, code=1)
        generated.set_sform(affine, code=1)
        original = private / "generated-synthetic-ct.nii.gz"
        output = private / "generated-synthetic-prediction.nii.gz"
        nib.save(generated, str(original))
        env = {**os.environ, "OPUS_AUTHORIZED_SAMIHS_BOOTSTRAP": "authorized-v1",
               "OMP_NUM_THREADS": "2", "MKL_NUM_THREADS": "2",
               "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
        env.pop("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", None)
        bootstrap = Path(__file__).with_name("samihs-verified-cpu-bootstrap.py")
        command = [sys.executable, str(bootstrap.resolve()), str(model_dir.resolve()),
                   wrapper_sha256, "--input", str(original),
                   "--output", str(output), "--device", "cpu",
                   "--batch-size", "1", "--threshold", "0.5", "--slice-axis", "2"]
        with tempfile.TemporaryFile(mode="w+b") as log:
            try:
                proc = subprocess.run(command, env=env, cwd=str(model_dir.resolve()),
                                      stdin=subprocess.DEVNULL, stdout=log,
                                      stderr=subprocess.STDOUT, timeout=timeout_seconds,
                                      check=False)
            except subprocess.TimeoutExpired:
                raise RuntimeError("synthetic_cpu_model_smoke_timed_out")
            if proc.returncode:
                log.seek(0, os.SEEK_END)
                log.seek(max(0, log.tell() - 32768))
                category = diagnostic_module().classify_upstream_failure(
                    log.read(), proc.returncode)
                raise RuntimeError("synthetic_cpu_model_smoke_failed; " + category)
        if not output.is_file() or output.is_symlink():
            raise RuntimeError("synthetic_cpu_model_smoke_missing_output")
        predicted = nib.load(str(output))
        if (predicted.shape != generated.shape or
                predicted.header.get_data_dtype().kind not in "iu" or
                not np.allclose(predicted.affine, affine, rtol=0, atol=0.05)):
            raise RuntimeError("synthetic_cpu_model_smoke_source_grid_mismatch")
        labels = np.asarray(predicted.dataobj)
        if not np.all((labels == 0) | (labels == 1)):
            raise RuntimeError("synthetic_cpu_model_smoke_nonbinary_output")
        print("Verified pretrained SAMIHS CPU inference generated a source-grid binary mask "
              "on ONE synthetic, nonpatient slice. No public CT inference or clinical Dice.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--wrapper-sha256", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=420)
    args = parser.parse_args()
    try:
        run_smoke(args.model_dir, args.wrapper_sha256, args.timeout_seconds)
    except Exception as error:
        if str(error).startswith("synthetic_cpu_model_smoke_failed; "):
            print(str(error), file=sys.stderr)
        else:
            print("SAMIHS CPU genuine-model preflight failed: " + type(error).__name__ +
                  " (vendor log and synthetic data suppressed)", file=sys.stderr)
        raise SystemExit(2)


if __name__ == "__main__":
    main()
