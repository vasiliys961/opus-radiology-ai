# Local Lungmask R231 worker — experimental R1 increment

This is an **engineering research feature**, not full R1 acceptance or a clinical
pathology detector. No cloud credentials or paid subscription are needed.

## Verified implementation and limits

* Browser → `127.0.0.1` → separate Python process → bound mask → existing MPR.
  The mask is checked against request/source/input SHA, mask SHA and all grid corners.
* Official **Lungmask 0.2.20 / R231**, Torch 2.6.0, SimpleITK 2.4.1; CPU only,
  batch 1, two Torch threads, native Lungmask preprocessing and 3D postprocessing.
  Labels: 0 background, 1 right lung, 2 left lung. No diagnostic negative finding.
* Input is the existing exact, decoded float32 NIfTI with **8,388,608 voxel cap**.
  Export/mask caps have not been raised. Full 512×512×139 Slicer CTChest exceeds
  the cap and is **not supported**. No automatic downsampling, cropping or fake
  slices were introduced to make it pass.
* Axial axis-aligned CT only. Signed LPS axes are reversed into the documented
  Lungmask numpy convention and reversed back without interpolation. Oblique,
  sagittal/coronal acquisitions, shears, MR, unknown intensity contracts and
  malformed/empty masks fail. Chest anatomy, complete transverse FOV and HU must
  be verified by the research operator; numeric HU range is only a sanity check.
* The result passport is structured specialist evidence (source identity, exact
  weights, labels, limitations). It stays distinct from LLM interpretations and
  clinician review. Gemini/Claude remain optional, and patient cloud stays OFF.
  Spatial fusion with LLM findings and signed review remain planned.

## Source and licensing record

Code: [Lungmask v0.2.20](https://github.com/JoHof/lungmask/tree/v0.2.20),
[project Apache-2.0 licence](https://github.com/JoHof/lungmask/blob/v0.2.20/LICENSE).
Official weights:
`https://github.com/JoHof/lungmask/releases/download/v0.0/unet_r231-d5d2fc3d.pth`.

SHA-256 measured from the official release, 2026-10-11:

```text
d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f
```

The project licence is recorded separately from checkpoint provenance. A separate
artifact-specific weights/dataset licence notice was not found. This increment
allows an explicit research-only install/use of the authors' published fixture;
it does **not** certify commercial, regional, patient-processing or redistribution
rights. Weights and public CT pixels are neither bundled nor committed. Commercial
deployment and clinical input remain blocked pending documented clearance.

## Start on Mac M1

Prerequisite: native arm64 Python **3.11 or 3.12** and the existing Node viewer.
This opt-in command installs the optional heavy stack in `.venv-lungmask`, verifies
the checkpoint, and starts the worker. It never reads/writes `.env.local`.

```bash
cd "$HOME/Desktop/opus-radiology-ai-github"
bash scripts/start-local-lungmask.sh --install --accept-research-license
```

Subsequent runs require no dependency or weight download:

```bash
bash scripts/start-local-lungmask.sh
```

Keep that terminal open. Paste its ephemeral session token into the MPR section
**Lungmask R231 · локальный CPU · экспериментальный режим**. The token is a local
access credential: do not send it into chats or save it in screenshots. It is kept
only in component memory and rotates when the worker restarts.

The default allowed browser Origin is exactly `http://localhost:3000`. If Next.js
is running at `http://127.0.0.1:3000`, use:

```bash
bash scripts/start-local-lungmask.sh --origin http://127.0.0.1:3000
```

After an authorized public reference series is loaded, enable MPR, confirm the
research scope/FOV/HU, and click **Сегментировать лёгкие локально**. Results are
imported automatically; inspect both labels in axial/coronal/sagittal planes.
Large scans stop at preflight; do not reinterpret that as a normal CT.

The first version requires a **local** HTTP viewer origin. An HTTPS-hosted viewer
may block local HTTP access due to browser mixed-content/private-network policy;
we do not bypass that protection. Safari and native Windows are not yet verified.

## Worker boundary and resource handling

* Fixed bind `127.0.0.1`, exact Host/Origin, random bearer on every request,
  allowlisted CORS preflight, no credentials/cookies, no provider-key inheritance.
* JSON is capped to 64 KiB and rejects unknown fields. Binary input is streamed
  into a generated private temporary directory with byte limits; clients cannot
  choose server paths. Volume access is memory-mapped; the upstream adapter itself
  still makes bounded copies inside the existing voxel limit.
* One active/retained job; free-memory/disk preflight; process RSS watchdog with
  **2 GiB** cap and **30 minute** TTL; CPU batch 1. Cancellation kills/reaps the
  model process and deletes its files. Downloads are checked before MPR import;
  success/failure cleanup is requested in `finally`. Abandoned jobs expire by TTL.
* Directory permissions 0700, files 0600 via CLI umask. No clinical data may be
  used in this temporary unencrypted research storage. Graceful shutdown removes
  it; abrupt OS/process termination can leave a temporary folder. This is not an
  encrypted patient store or crash-safe deletion guarantee.
* No access/body logs. Child stdout/stderr discarded. Safe error codes rather than
  raw library errors. Python socket connect, UDP send and DNS calls are disabled
  in inference; no download fallback is allowed. This is defence in a trusted
  pinned adapter, **not** an independently audited OS egress sandbox.

## Versioned job contract and four execution modes

| Mode | Current state in this increment |
|---|---|
| Browser | Existing viewer/MPR/evidence; browser medical WASM inference still planned |
| Local Mac/PC | New bounded loopback research CPU worker; Mac/Safari acceptance pending, Windows launcher pending |
| Private CPU server | Same job contract is intended; remote origins/binds deliberately unsupported until private-server security exists |
| Private GPU server | Contract planned; no GPU routing/production claims in this PR |

`GET /v1/capabilities` reports actual installed/pinned readiness. `POST /v1/jobs`
accepts `opus-worker-job/v1` containing an existing `opus-analysis-request/v1`,
research-only data policy and chest/HU declaration. `PUT /v1/jobs/{id}/input`
streams `application/octet-stream`. `GET /v1/jobs/{id}` returns real state/elapsed
time plus the existing `opus-segmentation-result/v1` and measured metrics on
success. `GET /v1/jobs/{id}/mask` returns NIfTI. `DELETE` cancels/reaps/deletes.
Source salt/request ID binds each result to this series/job; a hash is not a
cryptographic signature proving clinical validity or authorship.

## Actual tests and remaining acceptance

See [R1 verification record](R1_LUNGMASK_VERIFICATION.md). Default CI runs contract,
security and geometry tests without Torch/weights. Browser regressions are
synthetic and explicitly labelled. A manual real-model workflow/script downloads
only the authors' pinned public two-slice fixture, never user patient files.

Opt-in real model + actual loopback HTTP test on your hardware:

```bash
.venv-lungmask/bin/python -m pip install -r services/imaging-ai/requirements-dev.txt
.venv-lungmask/bin/python scripts/test-real-r231.py \
  --weights "$HOME/Models/Opus/unet_r231.pth" \
  --download-public-reference --http-worker \
  --report "$HOME/Downloads/opus-r231-hardware-reference.json"
```

The report contains measured hardware/runtime and voxel counts, **no CT pixels,
raw UIDs or patient tags**. It is a two-slice regression, not a complete chest or
clinical Dice evaluation. Different hardware reports must not be relabelled M1.

**Still required for R1:** legally cleared complete chest reference series,
native full-resolution streaming beyond the current cap, actual R231→MPR browser
end-to-end test, Safari/M1 8GB total system/browser/process memory and cancellation
measurement, independent ground-truth metrics, documented weight/data licence
clearance. Until these pass, R1 remains PARTIAL.
