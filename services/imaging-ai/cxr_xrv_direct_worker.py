#!/usr/bin/env python3
"""Original six-head TorchXRayVision research inference on one CXR DICOM-derived PNG.

Only public, authorized, NONPATIENT images; never transmit source DICOM.
Run a published, exactly SHA-pinned DenseNet121 by invoking the existing
scripts/real-xrv-pneumothorax-cxr.py on private isolated Linux CPU.
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
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response

MODEL_SHA = "31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf"
MODEL_FILE = "nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt"
VERSION = "1.5.7"
CAPABILITY = "opus-original-xrv-cxr-worker/v1"
SCHEMA = "opus-original-xrv-cxr-six-head/v1"
MAX_IMAGE_BYTES = 25 * 1024 * 1024
LABELS = ("Pneumothorax", "Cardiomegaly", "Effusion", "Pneumonia", "Edema", "Mass")


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for piece in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(piece)
    return h.hexdigest()


def verify_original_model(path):
    weight = Path(path)
    if platform.system() != "Linux":
        raise ValueError("XRV_isolated_Linux_research_only")
    if (
        weight.is_symlink()
        or not weight.is_file()
        or weight.name != MODEL_FILE
        or not 10 * 1024 * 1024 <= weight.stat().st_size <= 90 * 1024 * 1024
        or digest(weight) != MODEL_SHA
        or importlib.metadata.version("torchxrayvision") != VERSION
    ):
        raise ValueError("original_NIH_DenseNet121_checkpoint_or_version_unverified")
    return weight


def safe_public_url(url):
    if not isinstance(url, str) or len(url) > 1024 or any(c in url for c in "@?#\r\n\x00"):
        raise ValueError("public_research_source_URL_required")
    u = urlsplit(url)
    if (
        u.scheme != "https"
        or not u.hostname
        or u.username
        or u.password
        or u.port not in (None, 443)
        or u.hostname.lower() in ("localhost", "127.0.0.1")
    ):
        raise ValueError("public_research_source_URL_required")
    return url


def create_app(*, token, origin, weight_path, runner_path, port=8779):
    if not isinstance(token, str) or not 32 <= len(token) <= 128:
        raise ValueError("private_XRV_worker_token_required")
    if not isinstance(origin, str) or not (
        origin.startswith("http://127.0.0.1:")
        or origin.startswith("http://localhost:")
    ):
        raise ValueError("local_browser_origin_required")
    if not 1024 <= port <= 65535:
        raise ValueError("private_loopback_port_required")
    weight = verify_original_model(weight_path)
    runner = Path(runner_path)
    if not runner.is_file() or runner.is_symlink() or runner.name != "real-xrv-pneumothorax-cxr.py":
        raise ValueError("original_published_model_runner_missing")
    semaphore = asyncio.Lock()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def authorize(req: Request, handler):
        headers = {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        }
        if (
            req.headers.get("host") != f"127.0.0.1:{port}"
            or req.headers.get("origin") != origin
        ):
            return JSONResponse(
                {"detail": "local_origin_required"}, status_code=403, headers=headers
            )
        headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
        if req.method == "OPTIONS":
            requested = {
                h.strip().lower()
                for h in req.headers.get("access-control-request-headers", "").split(",")
                if h.strip()
            }
            if req.headers.get("access-control-request-method") not in ("GET", "POST") or not requested.issubset(
                {"authorization", "content-type", "x-opus-png-sha256", "x-opus-public-source-url"}
            ):
                return Response(status_code=403, headers=headers)
            headers.update({
                "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Opus-PNG-SHA256,X-Opus-Public-Source-URL",
                "Access-Control-Allow-Methods": "GET,POST",
                "Access-Control-Allow-Private-Network": "true",
            })
            return Response(status_code=204, headers=headers)
        if not secrets.compare_digest(
            req.headers.get("authorization", ""), "Bearer " + token
        ):
            return JSONResponse(
                {"detail": "unauthorized"}, status_code=401, headers=headers
            )
        result = await handler(req)
        result.headers.update(headers)
        return result

    @app.get("/v1/cxr/capabilities")
    async def capabilities():
        return {
            "schema": CAPABILITY,
            "model": "densenet121-res224-nih",
            "weightSha256": MODEL_SHA,
            "originalCheckpointVerified": digest(weight) == MODEL_SHA,
            "packageVersion": VERSION,
            "ready": True,
            "mode": "isolated-linux-cpu-research",
            "patientMode": False,
            "modelLabels": list(LABELS),
            "sourcePolicy": "approved-public-nonpatient-only",
            "outputType": "uncalibrated-image-level-scores",
        }

    @app.post("/v1/cxr/analyze")
    async def analyze(req: Request):
        if semaphore.locked():
            raise HTTPException(409, "original_XRV_busy")
        if req.headers.get("content-type") != "image/png":
            raise HTTPException(415, "exact_png_required")
        claimed_sha = req.headers.get("x-opus-png-sha256", "")
        if len(claimed_sha) != 64 or any(c not in "0123456789abcdef" for c in claimed_sha):
            raise HTTPException(422, "original_CXR_SHA256_required")
        try:
            source_url = safe_public_url(req.headers.get("x-opus-public-source-url", ""))
        except ValueError:
            raise HTTPException(422, "authorized_public_CXR_source_required") from None
        size_header = int(req.headers.get("content-length", "0") or "0")
        if size_header > MAX_IMAGE_BYTES:
            raise HTTPException(413, "public_CXR_PNG_exceeds_budget")
        async with semaphore:
            if digest(weight) != MODEL_SHA:
                raise HTTPException(503, "original_CXR_checkpoint_changed")
            with tempfile.TemporaryDirectory(prefix="opus-xrv-original-") as folder:
                root = Path(folder)
                source = root / "authorized-source.png"
                actual = hashlib.sha256()
                count = 0
                with source.open("xb") as target:
                    async for chunk in req.stream():
                        count += len(chunk)
                        if count > MAX_IMAGE_BYTES:
                            raise HTTPException(413, "public_CXR_PNG_exceeds_budget")
                        actual.update(chunk)
                        target.write(chunk)
                if (
                    count < 1024
                    or actual.hexdigest() != claimed_sha
                    or source.stat().st_size != count
                    or source.open("rb").read(8) != b"\x89PNG\r\n\x1a\n"
                ):
                    raise HTTPException(422, "public_CXR_raster_identity_or_png_invalid")
                report = root / "original-xrv-report.json"
                cmd = [
                    sys.executable,
                    str(runner),
                    "--image", str(source),
                    "--weights", str(weight),
                    "--output", str(report),
                    "--weights-sha256", MODEL_SHA,
                    "--source-url", source_url,
                    "--source-terms", "NIH Clinical Center ChestXray FAQ",
                    "--public-deidentified-licensed-research-only",
                ]
                env = {
                    k: v
                    for k, v in os.environ.items()
                    if k in ("PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
                             "LD_LIBRARY_PATH", "OMP_NUM_THREADS", "MKL_NUM_THREADS")
                }
                env.update({
                    "HF_HUB_OFFLINE": "1",
                    "TRANSFORMERS_OFFLINE": "1",
                    "HF_HUB_DISABLE_TELEMETRY": "1",
                })
                proc = await asyncio.create_subprocess_exec(
                    *cmd, env=env, stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL, start_new_session=True,
                )
                try:
                    await asyncio.wait_for(proc.wait(), timeout=240)
                    if (
                        proc.returncode != 0
                        or not report.is_file()
                        or not 512 <= report.stat().st_size <= 20 * 1024
                    ):
                        raise HTTPException(422, "genuine_original_XRV_forward_failed")
                    raw = json.loads(report.read_text())
                    other = raw.get("uncalibratedAdditionalPublisherTrainedImageLevelScores", {})
                    scores = {"Pneumothorax": raw.get("uncalibratedPneumothoraxImageLevelScore")}
                    scores.update(other)
                    if (
                        raw.get("schema") != "opus-xrv-nih-cxr-multitask-pretrained/v2"
                        or raw.get("originalTrainedCheckpointSHA256") != MODEL_SHA
                        or raw.get("originalSourceRadiographSHA256") != claimed_sha
                        or raw.get("actualPretrainedModelForwardCompleted") is not True
                        or raw.get("researchOnly") is not True
                        or raw.get("patientUseAllowed") is not False
                        or set(scores) != set(LABELS)
                        or not all(type(v) in (float, int) and 0 <= v <= 1 for v in scores.values())
                    ):
                        raise HTTPException(422, "original_XRV_result_identity_mismatch")
                    return {
                        "schema": SCHEMA,
                        "model": "densenet121-res224-nih",
                        "modelWeightSha256": MODEL_SHA,
                        "sourcePngSha256": claimed_sha,
                        "actualPretrainedModelForwardCompleted": True,
                        "labels": scores,
                        "spatialLocalizationSupported": False,
                        "clinicalValidation": False,
                        "scoresAreCalibratedProbabilities": False,
                        "negativeDiagnosisPermitted": False,
                        "patientMode": False,
                        "limitations": [
                            "True trained NIH model output on approved public research raster.",
                            "Six scores are uncalibrated, do not represent disease probabilities.",
                            "There are no model localization boxes or expert labels.",
                            "Clinical accuracy and absence of disease have not been established.",
                        ],
                    }
                finally:
                    if proc.returncode is None:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        await proc.wait()
    return app


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--weights", required=True)
    p.add_argument("--runner", default=str(
        Path(__file__).resolve().parents[2] / "scripts/real-xrv-pneumothorax-cxr.py"))
    p.add_argument("--port", type=int, default=8779)
    p.add_argument("--origin", default="http://127.0.0.1:3000")
    p.add_argument("--token-env", default="OPUS_XRV_WORKER_TOKEN")
    args = p.parse_args()
    token = os.environ.get(args.token_env, "")
    app = create_app(
        token=token, origin=args.origin, weight_path=args.weights,
        runner_path=args.runner, port=args.port,
    )
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
