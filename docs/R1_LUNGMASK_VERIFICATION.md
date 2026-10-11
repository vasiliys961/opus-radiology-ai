# R1 engineering verification — 2026-10-11

Baseline inspected: `main` **25418d205a116237ce0f7d7d872f1340502a9bb7**.
Before implementation, GitHub Actions confirmed:

* [Python requirements — success on that main commit](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38137931076).
* [Latest applicable main Web checks — success](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38133638484) on `98d4d762`; latest main merge was documentation/dependency-profile scoped.

## What actually ran

**Actual trained weights**, full SHA-256:
`d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f`.
Official release URL and licensing caveats are in [the worker guide](LOCAL_LUNGMASK_WORKER.md).

**Actual public CT input:** authors' `JoHof/lungmask` v0.2.20
[`tests/testdata`](https://github.com/JoHof/lungmask/tree/v0.2.20/tests/testdata),
exactly **512×512×2** voxels. No duplicated slices, resampling, hidden crop,
synthetic medical prediction or clinical patient input.

| Fixture | SHA-256 |
|---|---|
| 0.dcm | bbc8e6ad413d274b299ccaa5e07a40c85d890d51c4dddf62c241a903c34454f9 |
| 1.dcm | 8fbdd1761ad2b74f408a8cf3a6bab147d4451e139b8a594c772dc043ddeacb76 |

Final actual HTTP test exercised a real loopback TCP FastAPI/Uvicorn worker,
session/Origin authentication, streamed upload, separate real Torch/R231 process,
status, returned NIfTI/passport/metrics, exact original sform and job deletion
(204 followed by 404). Its output label counts matched the upstream regression:
background **423,000**, right lung **64,752**, left lung **36,536** voxels.
These counts are **not manually annotated ground truth** and do not establish Dice.

| Measurement | Final actual HTTP run |
|---|---|
| Hardware environment | Linux x86_64 execution container; not M1 |
| Torch / Lungmask | 2.6.0+cpu / 0.2.20 |
| Batch / threads | 1 / 2 |
| Model inference + postprocessing | **1.338 s** |
| Adapter total (input/checkpoint/initialization/inference/output) | **2.721 s** |
| Model-process peak RSS | **708.75 MiB** |
| RSS method | getrusage high-water RSS; runner PID namespace fallback |
| Browser/system memory | Not measured by this script |
| Clinical Dice / sensitivity / specificity | Not measured |
| Mac M1 8GB / Safari | Not tested |

Earlier adapter and HTTP development runs measured 1.253–1.496 s inference and
708.75–761.09 MiB RSS on this same small fixture. These are engineering observations,
not estimates of full chest performance or a portable hardware benchmark.

## Checks

```bash
# In the isolated optional engineering environment:
python -m pip check
python -m pytest services/imaging-ai/test_r231.py -q
python scripts/test-local-onnx.py
bash -n scripts/start-local-lungmask.sh
python scripts/test-real-r231.py --weights /path/to/verified/r231.pth \
  --download-public-reference --http-worker --report /outside/repo/metrics.json

cd web
npm test
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
npm run test:browser
```

* **18 worker/adapter contract tests passed**: missing/stale session, forbidden
  Origin/Host/preflight, concurrency, wrong modality/intensity/patient-policy,
  unexpected metadata, oversized body/volume, low memory, corrupted/symlinked
  weights, SHA/grid mismatch, LPS reversibility and kill/reap of a real waiting
  subprocess on cancellation. That cancellation child is not a model fixture.
* **159 web unit tests passed**, including new synthetic worker contract tests,
  wrong result/job/source rejection and release of worker jobs.
* **6 existing real ONNX runtime tests passed**, synthetic Identity weights only.
* Typecheck and production build passed. The browser check uses mathematical
  DICOM/masks and mocked readiness only: MPR/3D, mask geometry/provenance,
  unsupported MR→R231 rejection before any job, preservation of existing mask,
  disabled cloud endpoints and resource reset.
* No `.env.local`, user key, CT image, model weight or patient record was committed.

## Acceptance boundary

This increment is **R1 PARTIAL**. Real adapter + actual HTTP cycle are verified.
The browser action/return path has synthetic contract and viewer regressions;
**actual R231→MPR on a complete legal chest series has not been tested**.
The public upstream fixture has two slices; existing MPR requires at least three,
so this fixture must not be padded or relabelled as a complete browser study.

Full chest reference procurement/licence review, native large-volume streaming,
actual browser/M1/Safari performance and independent clinical ground truth remain
required. Slicer CTChest was inspected (512×512×139); it exceeds the unchanged
export limit and was **not** used for an inference/browser acceptance claim.

Clinical local patient mode, private CPU/GPU server mode, browser medical WASM
models and clinical LLM/specialist spatial reconciliation remain pending. No PR
is automatically merged and no direct `main` push is part of this work.


## Acknowledged-block upload verification — 2026-10-11

Starting main: `6ae278b6cdf678cae9e0b92c0777bd5c3b05043a` (PR #13 merged).
Both live main workflows were successful before this change:
[Python](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38153127040),
[Web](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38153127050).

Actual official R231 ran again through real authenticated TCP HTTP with 128 KiB
acknowledged chunks and explicit commit. Original two-slice public fixture,
checkpoint SHA, exact original sform and label counts above were unchanged.
Linux x86_64 / Torch 2.6.0+cpu: **1.239 s** inference/postprocessing,
**2.603 s** adapter total, **732.13 MiB** model-process high-water RSS.
These figures are not browser, full-chest or M1 measurements.

Commands (optional isolated environment; no files inside repository):

```bash
python scripts/test-real-r231.py --weights /path/to/verified/r231.pth \
  --download-public-reference --http-worker --chunked-upload \
  --report /outside/repo/chunk-metrics.json
python -m pytest services/imaging-ai/test_r231.py -q
python scripts/test-local-onnx.py
python -m pip check
cd web
npm test
npm run typecheck
NEXT_TELEMETRY_DISABLED=1 npm run build
npm run test:browser
```

* **22 worker tests** passed, including chunk offset/replay/body cap/incomplete
  commit, corrupt digest without model spawn, complete commit then real waiting
  subprocess kill/reap, and concurrent chunk/legacy-upload/commit rejection with
  DELETE during a blocked request body. No synthetic mask is a model claim.
* **164 web tests** passed. Chunk bytes and incremental SHA match the full export
  for oblique/signed LPS, fractional scalars and unequal dimensions. A maximum
  supported 512×512×32 input yields at most **131,072 bytes** per scalar block;
  producer waits for consumer and stops on abort. This checks buffer sizes,
  not total browser/system RAM on M1.
* Existing six ONNX tests passed using synthetic Identity weights; dependency
  check, typecheck and production build passed.
* Browser regression includes mathematical MR rejection and mathematical
  CT-tag fixture → mocked acknowledged upload → bound synthetic mask → three
  MPR planes, result provenance and job DELETE. **No trained medical inference
  occurs in this browser test**. Actual R231→MPR/full chest remains pending.

`@noble/hashes` 2.0.1 provides incremental SHA-256; no custom cryptographic
implementation. Two scalar passes avoid buffering the full input, at the cost
of rereading the source. Changes between passes are rejected by worker SHA
before inference; no automatic retry or resampling occurs.

Full-volume manual export, Cornerstone decoded image/volume storage, label-mask
allocation and upstream R231 full-volume operations remain separate memory
costs. The **8,388,608 voxel and 48 MiB MPR raw-volume guards are unchanged**.
This increment completes bounded transport within the existing supported size;
it does not complete DATA-02 large-study or R1/M1 acceptance.
