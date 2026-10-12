"""Research-only loopback worker. Shared v1 job contract; remote modes closed."""
import argparse
import base64
import asyncio
from contextlib import asynccontextmanager
import importlib.metadata
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sys
import tempfile
import time
from urllib.parse import urlsplit
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
import psutil

from r231 import MAX_INPUT, MAX_VOXELS, VERSION, WEIGHTS_SHA256, check_weights, validate_request
from resource_guard import PROFILES, preflight
from r231_inference import model_source
from full_ct import FULL_MAX_INPUT, FULL_MAX_FRAMES, is_full_request, crop_mask

JOB_TTL_SECONDS = 1800
MAX_UPLOAD_CHUNK = 256 * 1024


async def bounded_body(request, maximum):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > maximum:
            raise HTTPException(413, "body_limit")
        data.extend(chunk)
    return bytes(data)


def validate_origin(origin):
    parsed = urlsplit(origin)
    if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.port is None or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise ValueError("Origin must be an exact local HTTP origin with a port")


def model_ready(weights):
    try:
        check_weights(weights)
        model_source()
        for name, version in (("lungmask", VERSION), ("torch", "2.6.0"), ("SimpleITK", "2.4.1")):
            installed = importlib.metadata.version(name)
            if version and installed.split("+", 1)[0] != version:
                return False
        return True
    except (ValueError, OSError, importlib.metadata.PackageNotFoundError):
        return False


def create_app(weights, token, origin="http://localhost:3000", port=8765, temporary_root=None, profile="safe"):
    validate_origin(origin)
    if profile not in PROFILES:
        raise ValueError("unsupported_resource_profile")
    if not token or len(token) < 32:
        raise ValueError("A random session token is required")
    weights = Path(weights).absolute()
    jobs = {}
    root = Path(tempfile.mkdtemp(prefix="opus-public-worker-", dir=temporary_root))
    root.chmod(0o700)
    ready = model_ready(weights)

    def check_resources(r, stored_input_bytes=0):
        return preflight(r["geometry"]["dimensions"], r["frameCount"],
                         psutil.virtual_memory().available, shutil.disk_usage(root).free, profile, stored_input_bytes,
                         is_full_request(r))

    def resource_error(diagnostic):
        return {"reject-memory": "insufficient_memory", "reject-disk": "insufficient_disk",
                "reject-model-budget": "model_memory_budget_exceeded"}[diagnostic["guardDecision"]]

    async def discard(job):
        job["cancelRequested"] = True
        job["state"] = "cancelled"
        task = job.get("task")
        if task and job.get("started") and not job["started"].is_set():
            # Do not cancel subprocess creation mid-spawn and orphan a model.
            await job["started"].wait()
        proc = job.get("process")
        if proc and proc.returncode is None:
            proc.kill()
            await proc.wait()
        if task and task is not asyncio.current_task():
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        shutil.rmtree(job["directory"], ignore_errors=True)

    async def reap():
        while True:
            await asyncio.sleep(5)
            for identifier, job in list(jobs.items()):
                if time.monotonic() - job["created"] > JOB_TTL_SECONDS:
                    await discard(job)
                    jobs.pop(identifier, None)

    @asynccontextmanager
    async def lifespan(app):
        cleaner = asyncio.create_task(reap())
        try:
            yield
        finally:
            cleaner.cancel()
            try:
                await cleaner
            except asyncio.CancelledError:
                pass
            for job in list(jobs.values()):
                await discard(job)
            shutil.rmtree(root, ignore_errors=True)

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def boundary(request, call_next):
        headers = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}
        if request.headers.get("host") != f"127.0.0.1:{port}" or request.headers.get("origin") != origin:
            return JSONResponse({"detail": "origin_or_host_denied"}, status_code=403, headers=headers)
        headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin"})
        headers["Access-Control-Expose-Headers"] = "X-Opus-Mask-Proof, Content-Length"
        if request.method == "OPTIONS":
            requested = {v.strip().lower() for v in request.headers.get("access-control-request-headers", "").split(",") if v.strip()}
            if request.headers.get("access-control-request-method") not in {"GET", "POST", "PUT", "DELETE"} or not requested.issubset({"authorization", "content-type"}):
                return Response(status_code=403, headers=headers)
            headers.update({"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE",
                            "Access-Control-Allow-Headers": "Authorization, Content-Type",
                            "Access-Control-Allow-Private-Network": "true"})
            return Response(status_code=204, headers=headers)
        if not secrets.compare_digest(request.headers.get("authorization", ""), f"Bearer {token}"):
            return JSONResponse({"detail": "unauthorized"}, status_code=401, headers=headers)
        response = await call_next(request)
        response.headers.update(headers)
        return response

    @app.get("/v1/capabilities")
    async def capabilities():
        return {"schema": "opus-worker-capabilities/v1", "mode": "local", "device": "cpu",
                "model": {"id": "lungmask-R231", "version": VERSION, "weightsSha256": WEIGHTS_SHA256, "ready": ready},
                "maxVoxels": MAX_VOXELS, "concurrency": 1,
                "fullCt": {"requestSchema": "opus-analysis-request/v2", "maxPlane": 512, "maxFrames": FULL_MAX_FRAMES,
                           "maskAccess": "bounded-slabs-only"},
                "chunkUpload": {"version": 1, "maxChunkBytes": MAX_UPLOAD_CHUNK},
                "resourceProfile": {"name": profile, "threads": PROFILES[profile]["threads"], "interOpThreads": 1},
                "dataPolicy": "public-reference-only", "patientMode": False, "externalEgress": False,
                "remoteModes": "not-enabled", "status": "experimental"}

    @app.post("/v1/jobs", status_code=201)
    async def create_job(request: Request):
        if not ready:
            raise HTTPException(503, {"code": "model_not_ready"})
        if jobs:
            raise HTTPException(409, "worker_busy_delete_previous_job")
        try:
            body = json.loads(await bounded_body(request, 65536))
            if set(body) != {"schema", "dataPolicy", "acquisition", "request"} or body["schema"] != "opus-worker-job/v1":
                raise ValueError()
            # This declaration is for research scope, NOT a patient privacy gate.
            if body["dataPolicy"] != "public-reference-only" or body["acquisition"] != {"anatomy": "CHEST", "intensity": "HU", "confirmedBy": "research-operator"}:
                raise ValueError()
            validate_request(body["request"])
        except (ValueError, TypeError, KeyError, AttributeError, OverflowError):
            raise HTTPException(422, "unsupported_job_contract") from None
        # No await between checking the single slot and reserving it.
        if jobs:
            raise HTTPException(409, "worker_busy_delete_previous_job")
        diagnostic = check_resources(body["request"])
        if diagnostic["guardDecision"] != "allow":
            raise HTTPException(507, {"code": resource_error(diagnostic), "preflight": diagnostic})
        identifier = str(uuid.uuid4())
        directory = root / identifier
        try:
            directory.mkdir(mode=0o700)
            (directory / "request.json").write_text(json.dumps(body["request"]))
        except OSError:
            shutil.rmtree(directory, ignore_errors=True)
            raise HTTPException(507, {"code": "input_write_failed", "preflight": diagnostic}) from None
        jobs[identifier] = {"directory": directory, "created": time.monotonic(),
                            "state": "awaiting_input", "uploadedBytes": 0, "process": None,
                            "preflight": diagnostic, "guardDecision": "allow", "peakRssMiB": 0,
                            "inputHash": hashlib.sha256(), "uploadLock": asyncio.Lock(),
                            "inputLimit": FULL_MAX_INPUT if is_full_request(body["request"]) else MAX_INPUT}
        return {"schema": "opus-worker-job-status/v1", "jobId": identifier, "state": "awaiting_input",
                "preflight": diagnostic, "guardDecision": "allow"}

    def find(identifier):
        if identifier not in jobs:
            raise HTTPException(404, "job_not_found")
        return jobs[identifier]

    async def execute(job):
        proc = None
        try:
            r = json.loads((job["directory"] / "request.json").read_text())
            # Available memory can change while the browser hashes/uploads.
            diagnostic = check_resources(r, job["uploadedBytes"])
            job["preflight"] = diagnostic
            job["guardDecision"] = diagnostic["guardDecision"]
            if diagnostic["guardDecision"] != "allow":
                job["state"], job["error"] = "failed", resource_error(diagnostic)
                (job["directory"] / "input.nii").unlink(missing_ok=True)
                return
            # Provider keys/session bearer are never inherited by inference.
            environment = {k: v for k, v in os.environ.items() if k in {"PATH", "HOME", "TMPDIR", "SYSTEMROOT", "WINDIR"}}
            for name in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
                environment[name] = str(diagnostic["threads"])
            if profile == "safe":
                # Bound optional CPU backend primitive caches; ignored by
                # builds without these backends (including some Mac wheels).
                for name in ("LRU_CACHE_CAPACITY", "ONEDNN_PRIMITIVE_CACHE_CAPACITY", "DNNL_PRIMITIVE_CACHE_CAPACITY"):
                    environment[name] = "1"
            environment["TORCH_FORCE_WEIGHTS_ONLY_LOAD"] = "1"
            proc = await asyncio.create_subprocess_exec(sys.executable, str(Path(__file__).with_name("r231.py")),
                        str(job["directory"]), str(weights), profile, stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.DEVNULL, env=environment)
            job["process"] = proc
            job["started"].set()
            if job.get("cancelRequested"):
                proc.kill()
                await proc.wait()
                return
            job["state"] = "running"
            pressure_samples = 0
            while proc.returncode is None:
                pressure_samples = pressure_samples + 1 if psutil.virtual_memory().available < diagnostic["systemReserveBytes"] else 0
                if pressure_samples >= 3:
                    job["error"], job["guardDecision"] = "memory_pressure", "stop-memory-pressure"
                    job["preflight"]["runtimeAvailableRamBytes"] = psutil.virtual_memory().available
                    proc.kill()
                    break
                if time.monotonic() - job["created"] > JOB_TTL_SECONDS:
                    job["error"], job["guardDecision"] = "timeout", "stop-timeout"
                    proc.kill()
                    break
                try:
                    measured = psutil.Process(proc.pid)
                    rss = measured.memory_info().rss + sum(c.memory_info().rss for c in measured.children(recursive=True))
                    job["peakRssMiB"] = max(job["peakRssMiB"], round(rss / 1024**2, 2))
                    if rss > diagnostic["maxRssBytes"]:
                        job["error"], job["guardDecision"] = "rss_limit", "stop-rss-limit"
                        proc.kill()
                        break
                except psutil.Error:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=0.2)
                except asyncio.TimeoutError:
                    pass
            await proc.wait()
            job["state"] = "succeeded" if proc.returncode == 0 else "failed"
            if proc.returncode != 0:
                if proc.returncode == 75:
                    job["error"], job["guardDecision"] = "rss_limit", "stop-rss-limit"
                job.setdefault("error", "inference_failed_check_input_weights_and_dependencies")
            (job["directory"] / "input.nii").unlink(missing_ok=True)
        except asyncio.CancelledError:
            if proc and proc.returncode is None:
                proc.kill()
                await proc.wait()
            raise
        except Exception:
            job["state"], job["error"] = "failed", "worker_execution_failed"
            (job["directory"] / "input.nii").unlink(missing_ok=True)
        finally:
            if proc and proc.returncode is None:
                proc.kill()
                await proc.wait()
            job["started"].set()

    def queue(job):
        job["state"] = "queued"
        job["started"] = asyncio.Event()
        job["task"] = asyncio.create_task(execute(job))

    @app.put("/v1/jobs/{identifier}/input/chunks/{offset}")
    async def upload_chunk(identifier: str, offset: int, request: Request):
        job = find(identifier)
        # Reject concurrent requests rather than queue an unbounded number of bodies.
        if job["uploadLock"].locked():
            raise HTTPException(409, "upload_busy")
        async with job["uploadLock"]:
            if job["state"] not in {"awaiting_input", "receiving_chunks"}:
                raise HTTPException(409, "input_already_submitted")
            if offset != job["uploadedBytes"]:
                raise HTTPException(409, "chunk_offset_mismatch")
            if request.headers.get("content-type") != "application/octet-stream":
                raise HTTPException(415, "nifti_octet_stream_required")
            # Buffer one bounded block before appending: a disconnected request cannot
            # leave a partial block or advance its acknowledgement.
            try:
                data = await asyncio.wait_for(bounded_body(request, MAX_UPLOAD_CHUNK), timeout=30)
            except asyncio.TimeoutError:
                raise HTTPException(408, "chunk_timeout") from None
            if not data:
                raise HTTPException(422, "empty_chunk")
            if job.get("cancelRequested"):
                raise HTTPException(409, "job_cancelled")
            directory = job["directory"]
            r = json.loads((directory / "request.json").read_text())
            expected = 352 + 4 * int(__import__("math").prod(r["geometry"]["dimensions"]))
            if offset + len(data) > min(expected, job["inputLimit"]):
                raise HTTPException(413, "input_limit")
            # No await between cancellation check, disk append and acknowledgement.
            try:
                with (directory / "input.nii").open("xb" if offset == 0 else "ab") as stream:
                    stream.write(data)
            except OSError:
                job["state"] = "failed"
                (directory / "input.nii").unlink(missing_ok=True)
                raise HTTPException(507, "input_write_failed") from None
            job["inputHash"].update(data)
            job["uploadedBytes"] += len(data)
            job["state"] = "receiving_chunks"
            return {"uploadedBytes": job["uploadedBytes"], "state": "receiving_chunks"}

    @app.post("/v1/jobs/{identifier}/input/complete")
    async def complete_upload(identifier: str, request: Request):
        job = find(identifier)
        if job["uploadLock"].locked() or job["state"] != "receiving_chunks":
            raise HTTPException(409, "input_not_ready")
        async with job["uploadLock"]:
            if await bounded_body(request, 0):
                raise HTTPException(422, "empty_body_required")
            if job.get("cancelRequested"):
                raise HTTPException(409, "job_cancelled")
            directory = job["directory"]
            r = json.loads((directory / "request.json").read_text())
            expected = 352 + 4 * int(__import__("math").prod(r["geometry"]["dimensions"]))
            if job["uploadedBytes"] != expected:
                raise HTTPException(422, "input_size_mismatch")
            if job["inputHash"].hexdigest() != r["inputSha256"]:
                job["state"] = "failed"
                (directory / "input.nii").unlink(missing_ok=True)
                raise HTTPException(422, "input_sha_mismatch")
            queue(job)
            return {"state": "queued"}

    @app.put("/v1/jobs/{identifier}/input")
    async def upload(identifier: str, request: Request):
        job = find(identifier)
        if job["uploadLock"].locked() or job["state"] != "awaiting_input":
            raise HTTPException(409, "input_already_submitted")
        job["state"] = "uploading"
        directory = job["directory"]
        try:
            if request.headers.get("content-type") != "application/octet-stream":
                raise HTTPException(415, "nifti_octet_stream_required")
            r = json.loads((directory / "request.json").read_text())
            expected = 352 + 4 * int(__import__("math").prod(r["geometry"]["dimensions"]))
            with (directory / "input.nii").open("xb") as stream:
                async for chunk in request.stream():
                    job["uploadedBytes"] += len(chunk)
                    if job["uploadedBytes"] > min(job["inputLimit"], expected):
                        raise HTTPException(413, "input_limit")
                    if job["state"] == "cancelled":
                        raise HTTPException(409, "job_cancelled")
                    stream.write(chunk)
            if job["uploadedBytes"] != expected:
                raise HTTPException(422, "input_size_mismatch")
            queue(job)
            return {"state": "queued"}
        except BaseException:
            job["state"] = "failed"
            (directory / "input.nii").unlink(missing_ok=True)
            raise

    @app.get("/v1/jobs/{identifier}")
    async def status(identifier: str):
        job = find(identifier)
        response = {"schema": "opus-worker-job-status/v1", "jobId": identifier,
                    "state": job["state"], "uploadedBytes": job["uploadedBytes"],
                    "preflight": job["preflight"], "guardDecision": job["guardDecision"], "peakRssMiB": job["peakRssMiB"],
                    "elapsedSeconds": round(time.monotonic() - job["created"], 1)}
        if "error" in job:
            response["error"] = job["error"]
        if job["state"] == "succeeded":
            response["metrics"] = json.loads((job["directory"] / "metrics.json").read_text())
            response["metrics"].update(preflight=job["preflight"], guardDecision=job["guardDecision"])
            response["metrics"]["peakRssMiB"] = max(response["metrics"]["peakRssMiB"], job["peakRssMiB"])
            response["result"] = json.loads((job["directory"] / "result.json").read_text())
        progress_path = job["directory"] / "progress.json"
        if progress_path.exists() and progress_path.stat().st_size <= 4096:
            try:
                p = json.loads(progress_path.read_text())
                if (set(p) == {"stage", "completedFrames", "totalFrames"}
                        and p["stage"] in {"inference", "postprocessing", "restoration"}
                        and type(p["completedFrames"]) is int and type(p["totalFrames"]) is int
                        and 0 <= p["completedFrames"] <= p["totalFrames"] <= FULL_MAX_FRAMES):
                    response["progress"] = p
            except (ValueError, OSError, TypeError):
                pass
        return response

    @app.get("/v1/jobs/{identifier}/mask")
    async def mask(identifier: str):
        job = find(identifier)
        if job["state"] != "succeeded":
            raise HTTPException(409, "result_not_ready")
        r = json.loads((job["directory"] / "request.json").read_text())
        if is_full_request(r):
            raise HTTPException(409, "full_mask_requires_bounded_slab")
        return FileResponse(job["directory"] / "mask.nii", media_type="application/octet-stream")

    @app.post("/v1/jobs/{identifier}/mask-slab")
    async def mask_slab(identifier: str, request: Request):
        job = find(identifier)
        if job["state"] != "succeeded":
            raise HTTPException(409, "result_not_ready")
        if job["uploadLock"].locked():
            raise HTTPException(409, "slab_busy")
        async with job["uploadLock"]:
            try:
                body = json.loads(await bounded_body(request, 512))
                if not isinstance(body, dict) or set(body) != {"start", "count"}:
                    raise ValueError()
                r = json.loads((job["directory"] / "request.json").read_text())
                if not is_full_request(r):
                    raise ValueError()
                path, geometry = crop_mask(job["directory"], r, body["start"], body["count"])
                result = json.loads((job["directory"] / "result.json").read_text())
                proof = {"schema": "opus-full-ct-slab/v1", "jobId": identifier,
                         "requestId": r["requestId"], "sourceIdentitySha256": r["sourceIdentitySha256"],
                         "inputSha256": r["inputSha256"], "fullMaskSha256": result["maskSha256"],
                         "slabMaskSha256": __import__("r231").digest(path), "geometry": geometry,
                         "start": body["start"], "count": body["count"], "sourceFrameCount": r["frameCount"]}
                encoded = base64.b64encode(json.dumps(proof).encode()).decode("ascii")
                return Response(path.read_bytes(), media_type="application/octet-stream",
                                headers={"X-Opus-Mask-Proof": encoded})
            except (ValueError, TypeError, KeyError, OSError):
                raise HTTPException(422, "invalid_mask_range_or_result") from None

    @app.delete("/v1/jobs/{identifier}", status_code=204)
    async def cancel(identifier: str):
        job = find(identifier)
        await discard(job)
        jobs.pop(identifier, None)
        return Response(status_code=204)

    return app


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--origin", default="http://localhost:3000")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--profile", choices=tuple(PROFILES), default="safe")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("Invalid port")
    os.umask(0o077)
    session_token = secrets.token_urlsafe(32)
    app = create_app(args.weights, session_token, args.origin, args.port, profile=args.profile)
    print(f"Local research worker: http://127.0.0.1:{args.port}; origin: {args.origin}")
    print(f"Paste this ephemeral session token into the local worker panel: {session_token}", flush=True)
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port, access_log=False, log_level="warning")
