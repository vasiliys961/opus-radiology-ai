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
