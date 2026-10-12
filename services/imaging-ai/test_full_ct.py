"""Full streaming contracts use mathematical data/fake child; no trained-model claim."""
import base64
import hashlib
import itertools
import json
from pathlib import Path
import struct
import time
from types import SimpleNamespace

import numpy as np
import pytest
from fastapi.testclient import TestClient

from full_ct import write_restored_mask, crop_mask
from resource_guard import estimate_resources, preflight
from r231 import validate_request, load_volume, digest, WEIGHTS_SHA256
from test_r231 import packet, job, HEADERS, TOKEN
import worker


def test_full_contract_is_separate_and_resource_guard_remains():
    request, _ = packet()
    request["geometry"]["dimensions"] = [512, 512, 103]
    request["frameCount"] = 103
    with pytest.raises(ValueError, match="voxel_limit"):
        validate_request(request)
    request["schema"] = "opus-analysis-request/v2"
    assert validate_request(request) == [512, 512, 103]
    policy = estimate_resources([512, 512, 103], 103, full_stream=True)
    assert policy["threads"] == 1 and policy["maxRssBytes"] <= 2 * 1024**3
    assert preflight([512, 512, 103], 103, 0, 2**40, full_stream=True)["guardDecision"] == "reject-memory"
    assert preflight([512, 512, 103], 103, 2**40, 0, full_stream=True)["guardDecision"] == "reject-disk"
    request["geometry"]["dimensions"][0] = 513
    with pytest.raises(ValueError, match="full_stream_geometry_limit"):
        validate_request(request)


@pytest.mark.parametrize("flips", [combo for n in range(4) for combo in itertools.combinations(range(3), n)])
def test_disk_restoration_equals_full_native_array_for_all_signed_axes(tmp_path, flips):
    labels = (np.arange(6 * 4 * 5).reshape(6, 4, 5) % 3).astype(np.uint8)
    header = bytes(352)
    utils = SimpleNamespace(reshape_mask=lambda plane, box, shape: plane)
    path = tmp_path / "mask.nii"
    counts = write_restored_mask(path, header, labels, [None] * 6, labels.shape, utils, flips)
    actual = np.frombuffer(path.read_bytes()[352:], np.uint8).reshape(labels.shape)
    assert np.array_equal(actual, np.flip(labels, flips))
    assert counts[1:] == [int(np.count_nonzero(labels == i)) for i in (1, 2)]
    assert struct.unpack_from("<hh", path.read_bytes(), 70) == (2, 8)


def test_full_input_and_cropped_mask_keep_sha_exact_shifted_grid(tmp_path):
    request, content = packet((16, 16, 40))
    request["schema"] = "opus-analysis-request/v2"
    path = tmp_path / "input.nii"
    path.write_bytes(content)
    header, mapped = load_volume(path, request)
    assert isinstance(mapped, np.memmap)
    labels = (np.arange(40 * 16 * 16).reshape(40, 16, 16) % 3).astype(np.uint8)
    utils = SimpleNamespace(reshape_mask=lambda plane, box, shape: plane)
    write_restored_mask(tmp_path / "mask.nii", header, labels, [None] * 40, labels.shape, utils, ())
    cropped, geometry = crop_mask(tmp_path, request, 12, 8)
    assert geometry["dimensions"] == [16, 16, 8]
    assert geometry["affineLps"][11] == request["geometry"]["affineLps"][11] - 24
    assert cropped.read_bytes()[352:] == labels[12:20].tobytes()
    assert struct.unpack_from("<h", cropped.read_bytes(), 46)[0] == 8
    for start, count in [(-1, 8), (0, 33), (39, 3), (0.5, 8), (True, 8)]:
        with pytest.raises(ValueError):
            crop_mask(tmp_path, request, start, count)


def test_authenticated_full_job_chunk_commit_bounded_mask_proof_and_delete(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "model_ready", lambda weights: True)
    monkeypatch.setattr(worker.psutil, "virtual_memory", lambda: SimpleNamespace(available=8 * 1024**3))
    class Process:
        returncode = 0
        async def wait(self): return 0
    async def fake_child(*args, **kwargs):
        directory = Path(args[2]);request = json.loads((directory / "request.json").read_text())
        header, volume = load_volume(directory / "input.nii", request)
        labels = (volume > -700).astype(np.uint8)
        labels[:, 4:8, 4:8] = 2
        utils = SimpleNamespace(reshape_mask=lambda plane, box, shape: plane)
        counts = write_restored_mask(directory / "mask.nii", header, labels, [None] * labels.shape[0], labels.shape, utils, ())
        result = {"schema": "opus-segmentation-result/v1", **{k: request[k] for k in ("requestId", "sourceIdentitySha256", "inputSha256")},
                  "maskSha256": digest(directory / "mask.nii"),
                  "model": {"id": "lungmask-R231", "version": "0.2.20", "weightsSha256": WEIGHTS_SHA256, "modality": "CT", "task": "synthetic-full-contract"},
                  "labels": [{"id": 1, "name": "Synthetic outer"}, {"id": 2, "name": "Synthetic inner"}], "limitations": ["No trained inference"],
                  "fullVolume": {"dimensions": request["geometry"]["dimensions"], "labelVoxels": counts[1:], "coverage": "all-supplied-frames", "clinicalStatus": "unverified_research_draft"}}
        (directory / "result.json").write_text(json.dumps(result))
        (directory / "metrics.json").write_text(json.dumps({"device": "cpu", "inferenceSeconds": 0, "totalSeconds": 0, "peakRssMiB": 0}))
        return Process()
    monkeypatch.setattr(worker.asyncio, "create_subprocess_exec", fake_child)
    app = worker.create_app(tmp_path / "not-real-weights", TOKEN, temporary_root=tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        caps = client.get("/v1/capabilities", headers=HEADERS).json()
        assert caps["maxVoxels"] == 8388608 and caps["fullCt"]["maxFrames"] == 300
        # One native frame beyond the old 8,388,608-voxel admission boundary.
        request, content = packet((512, 512, 33));request["schema"] = "opus-analysis-request/v2"
        created = client.post("/v1/jobs", headers=HEADERS, json=job(request));assert created.status_code == 201
        identifier = created.json()["jobId"];base = f"/v1/jobs/{identifier}"
        binary_headers = {**HEADERS, "content-type": "application/octet-stream"}
        for offset in range(0, len(content), 131072):
            chunk = content[offset:offset+131072]
            assert client.put(base + f"/input/chunks/{offset}", headers=binary_headers, content=chunk).json()["uploadedBytes"] == offset + len(chunk)
        assert client.post(base + "/input/complete", headers=HEADERS).status_code == 200
        for _ in range(30):
            status = client.get(base, headers=HEADERS).json()
            if status["state"] in {"succeeded", "failed"}: break
            time.sleep(0.01)
        assert status["state"] == "succeeded"
        assert client.get(base + "/mask", headers=HEADERS).status_code == 409
        assert client.post(base + "/mask-slab", json={"start": 1, "count": 8}).status_code in (401, 403)
        response = client.post(base + "/mask-slab", headers=HEADERS, json={"start": 12, "count": 8})
        assert response.status_code == 200
        proof = json.loads(base64.b64decode(response.headers["X-Opus-Mask-Proof"]))
        assert proof["fullMaskSha256"] == status["result"]["maskSha256"]
        assert proof["inputSha256"] == request["inputSha256"] and proof["sourceIdentitySha256"] == request["sourceIdentitySha256"]
        assert proof["slabMaskSha256"] == hashlib.sha256(response.content).hexdigest()
        assert len(response.content) == 352 + 512 * 512 * 8
        assert client.post(base + "/mask-slab", headers=HEADERS, json={"start": 1, "count": 33}).status_code == 422
        assert client.delete(base, headers=HEADERS).status_code == 204
        assert client.get(base, headers=HEADERS).status_code == 404
