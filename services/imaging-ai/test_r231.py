"""Contract/security tests use synthetic scalars; no trained-model claim."""
import hashlib
import asyncio
import json
import struct
import uuid
import time
from types import SimpleNamespace

import numpy as np
import httpx
import pytest
from fastapi.testclient import TestClient

from r231 import canonical_axes, check_weights, load_volume, validate_request
import worker
from resource_guard import estimate_resources

TOKEN = "a" * 43
HEADERS = {"origin": "http://localhost:3000", "authorization": f"Bearer {TOKEN}"}


def packet(dims=(16, 16, 3), affine=None):
    affine = affine or [1, 0, 0, -9, 0, 1, 0, -8, 0, 0, -2, 7]
    h = bytearray(352)
    struct.pack_into("<i", h, 0, 348)
    struct.pack_into("<4h", h, 40, 3, *dims)
    struct.pack_into("<hh", h, 70, 16, 32)
    struct.pack_into("<f", h, 108, 352)
    struct.pack_into("<ff", h, 112, 1, 0)
    h[123] = 2
    struct.pack_into("<h", h, 254, 1)
    struct.pack_into("<12f", h, 280, *[(-v if i < 8 else v) for i, v in enumerate(affine)])
    h[344:348] = b"n+1\0"
    data = np.full(tuple(dims[::-1]), -1000, dtype="<f4")
    data[:, 4:12, 4:12] = 40
    content = bytes(h) + data.tobytes()
    r = {"schema": "opus-analysis-request/v1", "requestId": str(uuid.uuid4()),
         "sourceIdentitySha256": "b"*64, "inputSha256": hashlib.sha256(content).hexdigest(),
         "geometry": {"dimensions": list(dims), "affineLps": affine}, "modality": "CT",
         "frameCount": dims[2], "input": {"format": "NIfTI-1", "datatype": "float32", "scalarValues": "cornerstone-decoded-no-additional-normalization"},
         "scope": "selected-series-only", "sequence": "not-confirmed", "coverage": "not-confirmed"}
    return r, content


def job(r):
    return {"schema": "opus-worker-job/v1", "dataPolicy": "public-reference-only",
            "acquisition": {"anatomy": "CHEST", "intensity": "HU", "confirmedBy": "research-operator"}, "request": r}


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Boundary tests deliberately avoid loading Torch, downloading weights or
    # generating a fake successful medical result.
    monkeypatch.setattr(worker, "model_ready", lambda _: True)
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=16 * 1024**3))
    monkeypatch.setattr(worker.shutil, "disk_usage", lambda _: SimpleNamespace(free=16 * 1024**3))
    with TestClient(worker.create_app(tmp_path / "absent.pth", TOKEN, temporary_root=tmp_path), base_url="http://127.0.0.1:8765") as c:
        yield c
    assert not list(tmp_path.glob("opus-public-worker-*"))


def test_session_origin_host(client):
    assert client.get("/v1/capabilities", headers=HEADERS).json()["patientMode"] is False
    assert client.get("/v1/capabilities").status_code == 403
    assert client.get("/v1/capabilities", headers={"origin": HEADERS["origin"]}).status_code == 401
    assert client.get("/v1/capabilities", headers={**HEADERS, "origin": "http://evil.test"}).status_code == 403
    assert client.get("/v1/capabilities", headers={**HEADERS, "host": "evil.test:8765"}).status_code == 403
    assert client.get("/v1/capabilities", headers={**HEADERS, "authorization": "Bearer stale-token"}).status_code == 401
    assert client.options("/v1/jobs", headers={"origin": HEADERS["origin"], "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type"}).status_code == 204
    assert client.options("/v1/jobs", headers={"origin": HEADERS["origin"], "access-control-request-method": "POST", "access-control-request-headers": "x-arbitrary"}).status_code == 403


def test_preflight_and_cancel(client):
    r, _ = packet()
    created = client.post("/v1/jobs", headers=HEADERS, json=job(r))
    assert created.status_code == 201
    identifier = created.json()["jobId"]
    assert client.post("/v1/jobs", headers=HEADERS, json=job(r)).status_code == 409
    assert client.get(f"/v1/jobs/{identifier}/mask", headers=HEADERS).status_code == 409
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204
    assert client.get(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 404


@pytest.mark.parametrize("change", ["modality", "voxels", "oblique", "text", "patient", "hu", "float_frames"])
def test_unsupported_jobs(client, change):
    r, _ = packet()
    body = job(r)
    if change == "modality": r["modality"] = "MR"
    if change == "voxels": r["geometry"]["dimensions"] = [512, 512, 300]
    if change == "oblique": r["geometry"]["affineLps"][1] = 0.01
    if change == "text": r["patientName"] = "sentinel-never-persist"
    if change == "patient": body["dataPolicy"] = "patient"
    if change == "hu": body["acquisition"]["intensity"] = "unknown"
    if change == "float_frames": r["frameCount"] = float(r["frameCount"])
    assert client.post("/v1/jobs", headers=HEADERS, json=body).status_code == 422


def test_body_and_upload_limits(client):
    assert client.post("/v1/jobs", headers=HEADERS, content=b"x"*65537).status_code == 413
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    response = client.put(f"/v1/jobs/{identifier}/input", headers={**HEADERS, "content-type": "application/octet-stream"}, content=content+b"extra")
    assert response.status_code == 413
    assert client.get(f"/v1/jobs/{identifier}", headers=HEADERS).json()["state"] == "failed"
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204


def test_weights_corruption(tmp_path):
    p = tmp_path / "fake.pth"
    p.write_bytes(b"not-model-weights")
    with pytest.raises(ValueError, match="weights_sha_mismatch"): check_weights(p)
    link = tmp_path / "linked.pth"
    link.symlink_to(p)
    with pytest.raises(ValueError, match="weights_unavailable"): check_weights(link)


def test_chunk_offsets_limits_and_incomplete_commit(client):
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    base = f"/v1/jobs/{identifier}/input"
    headers = {**HEADERS, "content-type": "application/octet-stream"}
    assert client.get("/v1/capabilities", headers=HEADERS).json()["chunkUpload"] == {"version": 1, "maxChunkBytes": 262144}
    assert client.put(base+"/chunks/1", headers=headers, content=content[:352]).status_code == 409
    assert client.put(base+"/chunks/0", headers=headers, content=b"").status_code == 422
    assert client.put(base+"/chunks/0", headers=headers, content=b"x"*262145).status_code == 413
    ack = client.put(base+"/chunks/0", headers=headers, content=content[:352])
    assert ack.json() == {"state": "receiving_chunks", "uploadedBytes": 352}
    assert client.put(base+"/chunks/0", headers=headers, content=content[:352]).status_code == 409
    assert client.put(base+"/chunks/352", headers=headers, content=content).status_code == 413
    assert client.put(base, headers=headers, content=content).status_code == 409
    assert client.post(base+"/complete", headers=HEADERS).status_code == 422
    assert client.get(f"/v1/jobs/{identifier}", headers=HEADERS).json()["state"] == "receiving_chunks"
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204
    assert client.put(base+"/chunks/352", headers=headers, content=content[352:]).status_code == 404


def test_chunk_sha_mismatch_never_spawns_model(client, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Corrupt input must never start inference")
    monkeypatch.setattr(worker.asyncio, "create_subprocess_exec", forbidden)
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    base = f"/v1/jobs/{identifier}/input"
    corrupted = content[:-1] + bytes([content[-1] ^ 1])
    assert client.put(base+"/chunks/0", headers={**HEADERS, "content-type": "application/octet-stream"}, content=corrupted).status_code == 200
    assert client.post(base+"/complete", headers=HEADERS).status_code == 422
    assert client.get(f"/v1/jobs/{identifier}", headers=HEADERS).json()["state"] == "failed"
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204


def test_complete_chunk_upload_and_cancel_reaps_model(client, monkeypatch):
    children = []
    original = asyncio.create_subprocess_exec
    async def waiting_child(*args, **kwargs):
        process = await original(args[0], "-c", "import time; time.sleep(30)", **kwargs)
        children.append(process)
        return process
    monkeypatch.setattr(worker.asyncio, "create_subprocess_exec", waiting_child)
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    base = f"/v1/jobs/{identifier}/input"
    for offset in range(0, len(content), 512):
        ack = client.put(base+f"/chunks/{offset}", headers={**HEADERS, "content-type": "application/octet-stream"}, content=content[offset:offset+512])
        assert ack.status_code == 200
        assert ack.json()["uploadedBytes"] == min(offset+512, len(content))
        assert not children
    assert client.post(base+"/complete", headers=HEADERS).status_code == 200
    assert client.post(base+"/complete", headers=HEADERS).status_code == 409
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204
    assert children and children[0].returncode is not None


def test_concurrent_upload_and_delete_during_chunk_body(client):
    async def exercise():
        r, content = packet()
        entered, release = asyncio.Event(), asyncio.Event()
        async def blocked_body():
            yield content[:100]
            entered.set()
            await release.wait()
            yield content[100:]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app),
                                    base_url="http://127.0.0.1:8765", headers=HEADERS) as transport:
            identifier = (await transport.post("/v1/jobs", json=job(r))).json()["jobId"]
            base = f"/v1/jobs/{identifier}/input"
            headers = {"content-type": "application/octet-stream"}
            uploading = asyncio.create_task(transport.put(base+"/chunks/0", headers=headers, content=blocked_body()))
            await asyncio.wait_for(entered.wait(), timeout=5)
            assert (await transport.put(base+"/chunks/0", headers=headers, content=content)).status_code == 409
            assert (await transport.put(base, headers=headers, content=content)).status_code == 409
            assert (await transport.post(base+"/complete")).status_code == 409
            assert (await transport.delete(f"/v1/jobs/{identifier}")).status_code == 204
            release.set()
            assert (await asyncio.wait_for(uploading, timeout=5)).status_code == 409
            assert (await transport.get(f"/v1/jobs/{identifier}")).status_code == 404
            assert (await transport.post("/v1/jobs", json=job(r))).status_code == 201
    asyncio.run(exercise())


def test_memmap_exact_geometry_and_hash(tmp_path):
    r, content = packet()
    p = tmp_path / "input.nii"
    p.write_bytes(content)
    _, vol = load_volume(p, r)
    assert isinstance(vol, np.memmap)
    assert vol.shape == (3, 16, 16)
    r["geometry"]["affineLps"][3] += 1
    with pytest.raises(ValueError, match="geometry_mismatch"): load_volume(p, r)
    r, _ = packet()
    p.write_bytes(content[:-4]+b"xxxx")
    with pytest.raises(ValueError, match="input_size_or_sha_mismatch"): load_volume(p, r)


@pytest.mark.parametrize("signs", [(1,1,1), (-1,1,1), (1,-1,-1), (-1,-1,-1)])
def test_reversible_lps_axes(signs):
    volume = np.arange(60).reshape(3, 4, 5)
    a = [signs[0], 0, 0, 9, 0, signs[1], 0, 7, 0, 0, signs[2], 4]
    canonical, flips = canonical_axes(volume, a)
    np.testing.assert_array_equal(np.flip(canonical, flips), volume)
    i, j, k = (0 if s > 0 else n-1 for s, n in zip(signs, (5, 4, 3)))
    assert canonical[0,0,0] == volume[k,j,i]


def test_insufficient_memory(client, monkeypatch):
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: type("Memory", (), {"available": 1})())
    r, _ = packet()
    response = client.post("/v1/jobs", headers=HEADERS, json=job(r))
    assert response.status_code == 507
    detail = response.json()["detail"]
    assert detail["code"] == "insufficient_memory"
    assert detail["preflight"]["availableRamBytes"] == 1
    assert detail["preflight"]["guardDecision"] == "reject-memory"
    # Failed admission never reserves a slot; retry uses the same session.
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=16 * 1024**3))
    assert client.post("/v1/jobs", headers=HEADERS, json=job(r)).status_code == 201


def test_adaptive_safe_profile_accepts_native_reference_below_two_gib(client, monkeypatch):
    r, _ = packet()
    r["geometry"]["dimensions"], r["frameCount"] = [512, 512, 32], 32
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=1_382_678_528))
    response = client.post("/v1/jobs", headers=HEADERS, json=job(r))
    assert response.status_code == 201
    p = response.json()["preflight"]
    assert p["requiredRamBytes"] == 1219 * 1024**2
    assert p["profile"] == "safe" and p["threads"] == 1


def test_insufficient_disk_is_distinct_and_retryable(client, monkeypatch):
    r, _ = packet()
    monkeypatch.setattr(worker.shutil, "disk_usage", lambda _: SimpleNamespace(free=1))
    response = client.post("/v1/jobs", headers=HEADERS, json=job(r))
    assert response.status_code == 507
    assert response.json()["detail"]["code"] == "insufficient_disk"
    assert response.json()["detail"]["preflight"]["guardDecision"] == "reject-disk"
    monkeypatch.setattr(worker.shutil, "disk_usage", lambda _: SimpleNamespace(free=16 * 1024**3))
    assert client.post("/v1/jobs", headers=HEADERS, json=job(r)).status_code == 201


def test_model_not_ready_is_not_a_memory_error(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "model_ready", lambda _: False)
    with TestClient(worker.create_app(tmp_path/"absent.pth", TOKEN, temporary_root=tmp_path), base_url="http://127.0.0.1:8765") as c:
        assert c.get("/v1/capabilities", headers=HEADERS).json()["model"]["ready"] is False
        response = c.post("/v1/jobs", headers=HEADERS, json=job(packet()[0]))
        assert response.status_code == 503
        assert response.json()["detail"] == {"code": "model_not_ready"}


def await_failed(client, identifier):
    for _ in range(100):
        status = client.get(f"/v1/jobs/{identifier}", headers=HEADERS).json()
        if status["state"] == "failed":
            return status
        time.sleep(0.02)
    raise AssertionError("Resource guard did not stop the job")


def test_memory_rechecked_after_upload_before_inference(client, monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("Memory rejection must never spawn a model")
    monkeypatch.setattr(worker.asyncio, "create_subprocess_exec", forbidden)
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    base = f"/v1/jobs/{identifier}/input"
    assert client.put(base+"/chunks/0", headers={**HEADERS,"content-type":"application/octet-stream"}, content=content).status_code == 200
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=1))
    assert client.post(base+"/complete", headers=HEADERS).status_code == 200
    status = await_failed(client, identifier)
    assert status["error"] == "insufficient_memory"
    assert status["guardDecision"] == "reject-memory"
    assert status["preflight"]["availableRamBytes"] == 1
    assert status["peakRssMiB"] == 0
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204


@pytest.mark.parametrize("failure", ["pressure", "rss"])
def test_running_guard_reaps_child_and_preserves_retry(client, monkeypatch, failure):
    children = []
    original = asyncio.create_subprocess_exec
    async def waiting_child(*args, **kwargs):
        assert args[-1] == "safe"
        assert kwargs["env"]["OMP_NUM_THREADS"] == kwargs["env"]["VECLIB_MAXIMUM_THREADS"] == "1"
        assert kwargs["env"]["LRU_CACHE_CAPACITY"] == kwargs["env"]["ONEDNN_PRIMITIVE_CACHE_CAPACITY"] == "1"
        assert "OPENROUTER_API_KEY" not in kwargs["env"]
        process = await original(args[0], "-c", "import time; time.sleep(30)", **kwargs)
        children.append(process)
        if failure == "pressure":
            monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=1))
        else:
            measured = SimpleNamespace(memory_info=lambda: SimpleNamespace(rss=3 * 1024**3), children=lambda **_: [])
            monkeypatch.setattr(worker.psutil, "Process", lambda _: measured)
        return process
    monkeypatch.setattr(worker.asyncio, "create_subprocess_exec", waiting_child)
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    assert client.put(f"/v1/jobs/{identifier}/input", headers={**HEADERS,"content-type":"application/octet-stream"},content=content).status_code == 200
    status = await_failed(client, identifier)
    assert status["error"] == ("memory_pressure" if failure == "pressure" else "rss_limit")
    assert status["guardDecision"] == ("stop-memory-pressure" if failure == "pressure" else "stop-rss-limit")
    assert children[0].returncode is not None
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=16 * 1024**3))
    assert client.post("/v1/jobs", headers=HEADERS, json=job(r)).status_code == 201


def test_invalid_numeric_geometry():
    r, _ = packet()
    r["geometry"]["affineLps"][0] = float("nan")
    with pytest.raises(ValueError): validate_request(r)


def test_cancel_running_subprocess_is_reaped(client, monkeypatch):
    """A real Python child waits for cancellation; it never returns a fake mask."""
    children = []
    original = asyncio.create_subprocess_exec
    async def waiting_child(*args, **kwargs):
        process = await original(args[0], "-c", "import time; time.sleep(30)", **kwargs)
        children.append(process)
        return process
    monkeypatch.setattr(worker.asyncio, "create_subprocess_exec", waiting_child)
    r, content = packet()
    identifier = client.post("/v1/jobs", headers=HEADERS, json=job(r)).json()["jobId"]
    uploaded = client.put(f"/v1/jobs/{identifier}/input", headers={**HEADERS,"content-type":"application/octet-stream"},content=content)
    assert uploaded.status_code == 200
    assert client.delete(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 204
    assert children and children[0].returncode is not None
    assert client.get(f"/v1/jobs/{identifier}", headers=HEADERS).status_code == 404
    assert client.post("/v1/jobs", headers=HEADERS, json=job(r)).status_code == 201
