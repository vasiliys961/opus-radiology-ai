#!/usr/bin/env python3
"""Authenticated loopback bridge to ORIGINAL installed TotalSegmentator task315.

Research only: only rights-cleared nonpatient CT, isolated Linux CPU host,
pinned TotalSegmentator version and a preinstalled checkpoint. No cloud proxy,
no automatic download, and no simulated results.
"""
from __future__ import annotations
import argparse
import asyncio
import hashlib
import importlib.metadata
import json
import os
import platform
import secrets
import signal
import sys
import tempfile
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

from effusion_inference import AUTH, MIN_FREE_RAM_BYTES, PINNED_VERSION, TASK, digest
from totalsegmentator_input import inspect_input

MAX_SOURCE = 352 + 512 * 512 * 300 * 4
MAX_REPORT = 512 * 1024


def installed_model(checkpoint, checkpoint_sha256):
    """A separately observed cache-file SHA does NOT prove vendor loader choice."""
    w = Path(checkpoint)
    if (w.is_symlink() or not w.is_file() or not 1024 < w.stat().st_size < 1024**3
            or w.suffix not in (".pth", ".pt")
            or not isinstance(checkpoint_sha256, str)
            or len(checkpoint_sha256) != 64
            or digest(w) != checkpoint_sha256):
        raise ValueError("installed_original_task315_checkpoint_unverified")
    if platform.system() != "Linux" or importlib.metadata.version("TotalSegmentator") != PINNED_VERSION:
        raise ValueError("pinned_isolated_linux_runtime_unavailable")
    return w


def create_app(*, token, origin, checkpoint, checkpoint_sha256, port=8774):
    if not isinstance(token, str) or not 32 <= len(token) <= 128:
        raise ValueError("temporary_worker_token_required")
    if not (origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:")):
        raise ValueError("browser_loopback_origin_required")
    if not isinstance(port, int) or not 1024 <= port <= 65535:
        raise ValueError("loopback_port_required")
    w = installed_model(checkpoint, checkpoint_sha256)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    lock = asyncio.Lock()

    @app.middleware("http")
    async def authorize(request: Request, next_handler):
        headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
        if (request.headers.get("host") != f"127.0.0.1:{port}"
                or request.headers.get("origin") != origin):
            return JSONResponse({"detail": "unapproved_host_or_origin"}, status_code=403, headers=headers)
        headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
        if request.method == "OPTIONS":
            if (request.headers.get("access-control-request-method") not in ("POST", "GET")
                or not set(v.strip().lower() for v in request.headers.get(
                    "access-control-request-headers", "").split(",") if v.strip()).issubset(
                    {"authorization", "content-type", "x-opus-source-sha256"})):
                return Response(status_code=403, headers=headers)
            headers.update({"Access-Control-Allow-Methods": "GET,POST",
                "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Opus-Source-Sha256",
                "Access-Control-Allow-Private-Network": "true"})
            return Response(status_code=204, headers=headers)
        if not secrets.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse({"detail": "unauthorized"}, status_code=401, headers=headers)
        result = await next_handler(request)
        result.headers.update(headers)
        return result

    @app.get("/v1/effusion/capabilities")
    async def capabilities():
        import psutil
        return {
            "schema": "opus-original-task315-loopback/v1",
            "task": TASK, "model": "TotalSegmentator",
            "packageVersion": PINNED_VERSION, "checkpointFileSha256": checkpoint_sha256,
            "checkpointActiveVendorLoaderVerified": False,
            "checkpointFileVerified": digest(w) == checkpoint_sha256,
            "originalPretrainedTaskAvailable": True,
            "ready": psutil.virtual_memory().available >= MIN_FREE_RAM_BYTES,
            "mode": "local-linux-cpu-research", "patientMode": False,
            "dataPolicy": "public-nonpatient-research-only", "sourceFormat": "original-HU-NIfTI",
        }

    @app.post("/v1/effusion/analyze")
    async def analyze(request: Request):
        if lock.locked():
            raise HTTPException(409, "task315_worker_busy")
        if (request.headers.get("content-type") != "application/octet-stream"
                or not request.headers.get("x-opus-source-sha256", "")
                or len(request.headers["x-opus-source-sha256"]) != 64):
            raise HTTPException(415, "bounded_original_HU_CT_and_sha_required")
        expected = request.headers["x-opus-source-sha256"]
        if any(v not in "0123456789abcdef" for v in expected):
            raise HTTPException(422, "source_sha256_invalid")
        length = int(request.headers.get("content-length", "0") or 0)
        if length > MAX_SOURCE:
            raise HTTPException(413, "source_exceeds_native_CT_limit")
        async with lock:
            import psutil
            if psutil.virtual_memory().available < MIN_FREE_RAM_BYTES:
                raise HTTPException(507, "task315_requires_10GiB_available_ram")
            if digest(w) != checkpoint_sha256:
                raise HTTPException(503, "pretrained_checkpoint_modified")
            with tempfile.TemporaryDirectory(prefix="opus-real-task315-") as temp:
                root = Path(temp)
                source, mask, report = (root / "source.nii",
                                        root / "predicted.nii.gz", root / "report.json")
                sha = hashlib.sha256()
                count = 0
                with source.open("xb") as output:
                    async for chunk in request.stream():
                        if await request.is_disconnected():
                            raise HTTPException(499, "source_upload_aborted")
                        count += len(chunk)
                        if count > MAX_SOURCE:
                            raise HTTPException(413, "source_too_large")
                        sha.update(chunk)
                        output.write(chunk)
                if not 352 <= count == source.stat().st_size or sha.hexdigest() != expected:
                    raise HTTPException(422, "source_sha_mismatch")
                try:
                    if inspect_input(source)["dimensions"][2] < 8:
                        raise ValueError("incomplete_CT")
                except ValueError:
                    raise HTTPException(422, "invalid_native_CT_source") from None
                admission = root / "admission.json"
                # Operator authorization was required in browser before uploading.
                # This is an operator attestation, not independently proven de-identification.
                admission.write_text(json.dumps({
                    "schema": "opus-public-ct-task315-admission/v1",
                    "sourceSha256": expected, "modality": "CT",
                    "pixelIntensity": "verified-original-HU",
                    "fullAcquisitionCoverageVerified": True,
                    "publicOrRightsClearedResearchData": True,
                    "notRealPatientData": True, "originalImageLicenseReviewed": True,
                }))
                args = [sys.executable, str(Path(__file__).with_name("effusion_inference.py")),
                    "--source", str(source), "--output-mask", str(mask),
                    "--output-json", str(report), "--checkpoint", str(w),
                    "--checkpoint-sha256", checkpoint_sha256,
                    "--source-admission", str(admission), "--authorization", AUTH]
                env = {k:v for k,v in os.environ.items()
                       if k in {"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "LD_LIBRARY_PATH",
                                "TOTALSEG_HOME_DIR", "OMP_NUM_THREADS", "MKL_NUM_THREADS",
                                "OPENBLAS_NUM_THREADS"}}
                env.update({"HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
                            "HF_HUB_DISABLE_TELEMETRY": "1"})
                process = await asyncio.create_subprocess_exec(*args,
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    env=env, start_new_session=True)
                try:
                    for _ in range(2400):
                        if await request.is_disconnected():
                            raise HTTPException(499, "worker_client_disconnected")
                        try:
                            await asyncio.wait_for(process.wait(), timeout=1)
                            break
                        except asyncio.TimeoutError:
                            pass
                    else:
                        raise HTTPException(504, "original_task315_timeout")
                    if process.returncode != 0 or not report.is_file() or report.stat().st_size > MAX_REPORT:
                        raise HTTPException(422, "original_task315_inference_failed")
                    evidence = json.loads(report.read_text(encoding="utf-8"))
                    if (evidence.get("schema") != "opus-real-task315-effusion-execution/v1"
                            or evidence.get("sourceNiftiSha256") != expected
                            or evidence.get("observedInstalledWeightFileSha256") != checkpoint_sha256
                            or evidence.get("actualPretrainedInferenceClaimed") is not True
                            or evidence.get("runMode") != "isolated-author-installed"
                            or evidence.get("maskSha256") != digest(mask)
                            or digest(w) != checkpoint_sha256):
                        raise HTTPException(422, "unverified_task315_execution_result")
                    return evidence
                finally:
                    if process.returncode is None:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        await process.wait()
    return app


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--checkpoint", required=True)
    p.add_argument("--checkpoint-sha256", required=True)
    p.add_argument("--origin", default="http://127.0.0.1:3000")
    p.add_argument("--port", type=int, default=8774)
    a = p.parse_args()
    token = secrets.token_urlsafe(36).replace("-", "_")
    app = create_app(token=token, origin=a.origin, checkpoint=a.checkpoint,
                     checkpoint_sha256=a.checkpoint_sha256, port=a.port)
    print("Task315 worker temporary token: " + token, flush=True)
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=a.port, access_log=False)


if __name__ == "__main__":
    main()
