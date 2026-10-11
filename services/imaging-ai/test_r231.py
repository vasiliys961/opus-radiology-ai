"""Contract/security tests use synthetic scalars; no trained-model claim."""
import hashlib
import asyncio
import json
import struct
import uuid

import numpy as np
import pytest
from fastapi.testclient import TestClient

from r231 import canonical_axes, check_weights, load_volume, validate_request
import worker

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


@pytest.mark.parametrize("change", ["modality", "voxels", "oblique", "text", "patient", "hu"])
def test_unsupported_jobs(client, change):
    r, _ = packet()
    body = job(r)
    if change == "modality": r["modality"] = "MR"
    if change == "voxels": r["geometry"]["dimensions"] = [512, 512, 300]
    if change == "oblique": r["geometry"]["affineLps"][1] = 0.01
    if change == "text": r["patientName"] = "sentinel-never-persist"
    if change == "patient": body["dataPolicy"] = "patient"
    if change == "hu": body["acquisition"]["intensity"] = "unknown"
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
    assert client.post("/v1/jobs", headers=HEADERS, json=job(r)).status_code == 507


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
