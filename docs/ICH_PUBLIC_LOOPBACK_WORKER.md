# Original ianpan CT-ICH: isolated public-reference worker

This worker exposes the **original**, pinned `ianpan/ct-head-hemorrhage-detection`
inference for a **pre-approved public axial NCCT** on a provisioned isolated
Linux host. It is an optional execution service for the existing
`run-public-ich-dicom-evidence.py`, **not** a new model, clinical validation,
patient-mode authorization or automatically installed Mac process.

## Safety and provenance

- A manifest pins 8–64 public DICOM files and their SHA-256; no patient data,
  hospital study or unknown DICOM may be admitted.
- The browser will submit **file SHA-256 digests only**. The original public
  DICOM files must already be provisioned on the worker host. The backend checks
  the exact expected digest multiset, independently re-hashes all source files
  and refuses any modified manifest.
- Every original ianpan model file is verified against the publisher's exact
  pinned SHA before readiness. The model code executes in a killable subprocess,
  with a one-job queue, 3600-second timeout, memory-pressure/RSS safeguards and
  temporary result deletion on DELETE or shutdown.
- HTTP binds to `127.0.0.1` only; Origin, Host and random bearer token are
  checked, including preflight. On a separate GPU/CPU host use a trusted
  **SSH local-port tunnel**, not a publicly reachable worker port.
- Both private DICOM SOP Instance UIDs and model Evidence remain on the approved
  worker/browser. Never upload a result or full diagnostic pixels to GitHub.
  Network isolation must be enforced by the host; the process disables
  Hugging Face downloads after source/weights provision but does not implement
  operating-system firewall rules.

## Provision once on an isolated Linux research host

Verify licenses and independently attest the source rights and privacy.
Install Python 3.11, suitable CPU PyTorch runtime and the original ianpan
dependencies detailed in the existing
`.github/workflows/ich-ianpan-real-figshare.yml`, plus:

```bash
python -m pip install "fastapi==0.115.12" "uvicorn==0.34.2" "psutil==6.1.1" \
  "pydicom==3.0.1" "numpy==2.2.6" "nibabel==5.3.2"
export OPUS_ICH_WORKER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(32))')"
python services/imaging-ai/ich_public_worker.py \
  --dicom-dir /approved-public-dicom/ct \
  --public-manifest /approved-public-dicom/authorization.json \
  --model-dir /verified-ianpan-weights \
  --origin http://localhost:3000 --port 8766
```

The worker serves `GET /v1/ich/capabilities`,
`POST /v1/ich/jobs` (strict source SHA list), `GET /v1/ich/jobs/{id}`,
`GET /v1/ich/jobs/{id}/evidence`, and `DELETE /v1/ich/jobs/{id}`.
All routes require the bearer token and exact local Origin. Do not store token
in Git, browser localStorage, URL, logs or GitHub Actions.

## Unfinished application connection

The browser's unified-launch component does **not yet** invoke this new worker.
The next increment must verify the worker's model-source capabilities, compute
SHA-256 for the open local DICOM `File` objects, compare immutable public source
identity, and use its returned original-source `EvidenceJson` through existing
`dispatchDicomDetectors` — with cancellation and per-SOP review. The current
worker itself is functional only after the authorized data/model prerequisites
are provisioned, and real end-to-end inference in this worker remains untested.

Default CI is synthetic contract testing. Never infer clinical sensitivity,
negative hemorrhage diagnosis or model accuracy from a successful API call.
