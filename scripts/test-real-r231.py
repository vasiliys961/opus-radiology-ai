#!/usr/bin/env python3
"""Opt-in actual R231 regression on the authors' two-slice public CT fixture.

No images/PHI/weights are written into the repository. This is NOT a full chest
benchmark, clinical Dice evaluation, or browser/M1 acceptance.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import struct
import socket
import time
import sys
import tempfile
import urllib.request
import uuid

import numpy as np
import pydicom

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/imaging-ai"))
from r231 import WEIGHTS_SHA256, check_weights, digest

FIXTURE = ["bbc8e6ad413d274b299ccaa5e07a40c85d890d51c4dddf62c241a903c34454f9",
           "8fbdd1761ad2b74f408a8cf3a6bab147d4451e139b8a594c772dc043ddeacb76"]


def run_http_worker(directory, weights, chunked=False):
    """Real TCP job/upload/subprocess/result/delete cycle, not an API mock."""
    import httpx
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    server = subprocess.Popen([sys.executable, str(ROOT / "services/imaging-ai/worker.py"),
                               "--weights", str(weights.absolute()), "--port", str(port)],
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
    try:
        server.stdout.readline()
        token_line = server.stdout.readline()
        token = token_line.rsplit(": ", 1)[-1].strip()
        if len(token) != 43:
            raise ValueError("Worker did not issue a session token")
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", trust_env=False, timeout=20,
                          headers={"origin":"http://localhost:3000","authorization":f"Bearer {token}"}) as client:
            for attempt in range(100):
                try:
                    caps = client.get("/v1/capabilities")
                    caps.raise_for_status()
                    assert caps.json()["model"]["ready"] is True
                    break
                except httpx.ConnectError:
                    time.sleep(0.1)
            else:
                raise ValueError("Loopback worker did not start")
            request = json.loads((directory / "request.json").read_text())
            created = client.post("/v1/jobs", json={"schema":"opus-worker-job/v1", "dataPolicy":"public-reference-only",
                "acquisition":{"anatomy":"CHEST","intensity":"HU","confirmedBy":"research-operator"}, "request":request})
            created.raise_for_status()
            identifier = created.json()["jobId"]
            try:
                with (directory / "input.nii").open("rb") as stream:
                    if chunked:
                        assert caps.json()["chunkUpload"] == {"version":1,"maxChunkBytes":262144}
                        offset = 0
                        while block := stream.read(128 * 1024):
                            uploaded = client.put(f"/v1/jobs/{identifier}/input/chunks/{offset}",
                                content=block,headers={"content-type":"application/octet-stream"})
                            uploaded.raise_for_status()
                            offset += len(block)
                            assert uploaded.json()["uploadedBytes"] == offset
                        completed = client.post(f"/v1/jobs/{identifier}/input/complete")
                        completed.raise_for_status()
                    else:
                        uploaded = client.put(f"/v1/jobs/{identifier}/input", content=stream,headers={"content-type":"application/octet-stream"})
                        uploaded.raise_for_status()
                deadline = time.monotonic() + 300
                while time.monotonic() < deadline:
                    response = client.get(f"/v1/jobs/{identifier}")
                    response.raise_for_status()
                    status = response.json()
                    if status["state"] == "failed":
                        raise ValueError("Real HTTP worker inference failed")
                    if status["state"] == "succeeded":
                        mask = client.get(f"/v1/jobs/{identifier}/mask")
                        mask.raise_for_status()
                        (directory / "mask.nii").write_bytes(mask.content)
                        (directory / "result.json").write_text(json.dumps(status["result"]))
                        (directory / "metrics.json").write_text(json.dumps(status["metrics"]))
                        break
                    time.sleep(0.2)
                else:
                    raise TimeoutError("Worker timeout")
            finally:
                deleted = client.delete(f"/v1/jobs/{identifier}")
                assert deleted.status_code == 204
                assert client.get(f"/v1/jobs/{identifier}").status_code == 404
    finally:
        server.terminate()
        try:
            server.wait(timeout=15)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
        server.stdout.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--download-public-reference", action="store_true", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--http-worker", action="store_true", help="Exercise real authenticated loopback HTTP service")
    parser.add_argument("--chunked-upload", action="store_true", help="Use bounded acknowledged blocks; requires --http-worker")
    args = parser.parse_args()
    if args.chunked_upload and not args.http_worker:
        parser.error("--chunked-upload requires --http-worker")
    check_weights(args.weights)
    with tempfile.TemporaryDirectory(prefix="opus-r231-public-regression-") as temporary:
        directory = Path(temporary)
        frames = []
        for i, expected in enumerate(FIXTURE):
            target = directory / f"{i}.dcm"
            url = f"https://raw.githubusercontent.com/JoHof/lungmask/v0.2.20/tests/testdata/{i}.dcm"
            with urllib.request.urlopen(url, timeout=30) as response:
                data = response.read(600000)
            if len(data) != 525198 or hashlib.sha256(data).hexdigest() != expected:
                raise ValueError("Public reference checksum changed")
            target.write_bytes(data)
            frames.append(pydicom.dcmread(target))
        # Use only technical geometry and quantitative HU. No identifiers/logs.
        first = frames[0]
        spacing = [float(first.PixelSpacing[1]), float(first.PixelSpacing[0]),
                   float(frames[1].ImagePositionPatient[2])-float(first.ImagePositionPatient[2])]
        if list(map(float, first.ImageOrientationPatient)) != [1,0,0,0,1,0]:
            raise ValueError("Unexpected fixture orientation")
        origin = list(map(float, first.ImagePositionPatient))
        affine = [spacing[0],0,0,origin[0],0,spacing[1],0,origin[1],0,0,spacing[2],origin[2]]
        volume = np.stack([d.pixel_array.astype(np.float32)*float(d.RescaleSlope)+float(d.RescaleIntercept) for d in frames])
        dims = list(volume.shape[::-1])
        header = bytearray(352)
        struct.pack_into("<i", header, 0, 348)
        struct.pack_into("<4h", header, 40, 3, *dims)
        struct.pack_into("<hh", header, 70, 16, 32)
        struct.pack_into("<4f", header, 76, 1, *spacing)
        struct.pack_into("<f", header, 108, 352)
        struct.pack_into("<ff", header, 112, 1, 0)
        header[123] = 2
        struct.pack_into("<h", header, 254, 1)
        struct.pack_into("<12f", header, 280, *[-v if i<8 else v for i,v in enumerate(affine)])
        header[344:348] = b"n+1\0"
        (directory / "input.nii").write_bytes(header + volume.astype("<f4").tobytes())
        r = {"schema":"opus-analysis-request/v1", "requestId":str(uuid.uuid4()),
             "sourceIdentitySha256": hashlib.sha256("".join(FIXTURE).encode()).hexdigest(),
             "inputSha256":digest(directory / "input.nii"),
             "geometry":{"dimensions":dims,"affineLps":affine},"modality":"CT","frameCount":2,
             "input":{"format":"NIfTI-1","datatype":"float32","scalarValues":"cornerstone-decoded-no-additional-normalization"},
             "scope":"selected-series-only","sequence":"not-confirmed","coverage":"not-confirmed"}
        (directory / "request.json").write_text(json.dumps(r))
        if args.http_worker:
            run_http_worker(directory, args.weights, args.chunked_upload)
        else:
            subprocess.run([sys.executable,str(ROOT / "services/imaging-ai/r231.py"),str(directory),str(args.weights.absolute())],check=True, timeout=300)
        result = json.loads((directory / "result.json").read_text())
        mask = (directory / "mask.nii").read_bytes()
        assert mask[280:328] == header[280:328]  # exact source sform
        assert result["model"]["weightsSha256"] == WEIGHTS_SHA256
        values, counts = np.unique(np.frombuffer(mask, dtype="uint8", offset=352),return_counts=True)
        assert list(values) == [0,1,2]
        # Counts are a reproducibility regression from upstream test_mask.py;
        # NOT manual ground truth and NOT a clinical Dice score.
        assert list(counts) == [423000,64752,36536], list(counts)
        metrics = json.loads((directory / "metrics.json").read_text())
        report = {"schema":"opus-r231-reference-regression/v1","status":"passed",
                  "reference":"JoHof/lungmask v0.2.20 tests/testdata (two CT slices)",
                  "sourceSha256":FIXTURE,"weightsSha256":WEIGHTS_SHA256,
                  "labelVoxels":dict(zip(map(str,values),map(int,counts))),"geometry":"exact original sform preserved",
                  "metrics":metrics,"transport":"loopback-http-chunks" if args.chunked_upload else ("loopback-http" if args.http_worker else "adapter-subprocess"), "clinicalDice":None,"M1Acceptance":"not-tested",
                  "limitations":["Only two public reference slices; no full study, browser or clinical validation.",
                                 "Repository Apache-2.0; no separately explicit dataset/weights licence artifact found; no redistribution or commercial clearance implied."]}
        with args.report.open("x") as stream:
            json.dump(report,stream,indent=2)
        print(json.dumps({"status":"passed","metrics":metrics,"labelVoxels":report["labelVoxels"],"clinicalDice":None}))


if __name__ == "__main__":
    main()
