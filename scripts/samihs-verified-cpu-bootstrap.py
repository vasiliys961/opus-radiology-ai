#!/usr/bin/env python3
"""Scoped legacy PyTorch loader for the *authentic* SAMIHS research checkpoint.

The immutable upstream wrapper may explicitly request weights_only=True; the
PyTorch environment override only applies to calls omitting that parameter.
This executable is used ONLY in an operator-authorized, disposable research
CPU process. It does not alter the published vendor source or original weights.
No CT filenames, pixels, model output or vendor exceptions are logged here.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import runpy
import sys

SAMIHS_SHA256 = "b4c5ff729b906605555f83359120341a72035d1b6a784a9fef7dd61ee09a639e"
CHECKPOINT_REL = Path("weights/SAMIHS_09170527_2_0.483.pth")
WRAPPER_REL = "segment_ich.py"
SHA = re.compile(r"^[0-9a-f]{64}$")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def execute_verified_vendor(model_dir: Path, wrapper_sha256: str,
                            vendor_args: list[str]) -> int:
    if (sys.platform != "linux"
            or os.environ.get("OPUS_AUTHORIZED_SAMIHS_BOOTSTRAP") != "authorized-v1"
            or os.environ.get("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD")
            or os.environ.get("TORCH_FORCE_WEIGHTS_ONLY_LOAD", "").lower()
            in ("1", "yes", "y", "true")):
        raise ValueError("isolated_authorized_cpu_checkpoint_loader_required")
    if not SHA.fullmatch(wrapper_sha256):
        raise ValueError("pinned_wrapper_sha256_required")
    if model_dir.is_symlink() or not model_dir.is_dir():
        raise ValueError("pinned_model_directory_required")
    checkpoint = model_dir / CHECKPOINT_REL
    wrapper = model_dir / WRAPPER_REL
    if (checkpoint.is_symlink() or wrapper.is_symlink()
            or not checkpoint.is_file() or not wrapper.is_file()
            or checkpoint.stat().st_size > 2 * 1024**3
            or wrapper.stat().st_size > 1024 * 1024
            or sha256_file(checkpoint) != SAMIHS_SHA256
            or sha256_file(wrapper) != wrapper_sha256):
        raise ValueError("pinned_upstream_checkpoint_or_wrapper_sha256_mismatch")
    import torch

    checkpoint = checkpoint.resolve()
    original_load = torch.load
    approved_loads = 0

    def checkpoint_scoped_load(file, *args, **kwargs):
        nonlocal approved_loads
        # Only override the precisely SHA-verified original checkpoint.
        # Other checkpoints retain native PyTorch weights-only protection.
        candidate = file if isinstance(file, (str, bytes, os.PathLike)) else getattr(file, "name", None)
        try:
            is_original = (candidate is not None
                           and Path(candidate).resolve() == checkpoint)
        except (TypeError, ValueError, OSError):
            is_original = False
        if is_original:
            approved_loads += 1
            kwargs["weights_only"] = False
            # The official checkpoint may contain tensors originally saved
            # from CUDA. On this explicitly CPU-only task, map ONLY this
            # verified checkpoint to CPU, even if upstream omits map_location.
            if args:
                args = ("cpu", *args[1:])
                kwargs.pop("map_location", None)
            else:
                kwargs["map_location"] = "cpu"
        return original_load(file, *args, **kwargs)

    import os as _os
    original_argv = sys.argv
    original_cwd = Path.cwd()
    original_path = list(sys.path)
    try:
        torch.load = checkpoint_scoped_load
        sys.argv = [str(wrapper), *vendor_args]
        sys.path.insert(0, str(model_dir.resolve()))
        _os.chdir(model_dir.resolve())
        try:
            runpy.run_path(str(wrapper.resolve()), run_name="__main__")
        except SystemExit as exc:
            if exc.code not in (None, 0):
                raise
        if approved_loads == 0:
            raise RuntimeError("verified_samihs_checkpoint_was_never_loaded")
    finally:
        torch.load = original_load
        sys.argv = original_argv
        sys.path[:] = original_path
        _os.chdir(original_cwd)
    return approved_loads


if __name__ == "__main__":
    if len(sys.argv) < 4:
        raise SystemExit("verified_model_and_vendor_cli_required")
    execute_verified_vendor(Path(sys.argv[1]), sys.argv[2], sys.argv[3:])
