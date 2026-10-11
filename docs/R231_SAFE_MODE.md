# Local R231 adaptive resources — experimental

This feature replaces the fixed 2 GiB *available-memory* gate. It does not remove
the 2 GiB absolute model-process ceiling, 8,388,608-voxel input cap, 48 MiB MPR
guard, single job slot, source SHA/mask binding or research-only loopback boundary.
Browser / local CPU / private CPU / private GPU remain the product architecture;
only the existing local CPU adapter changes. Gemini/Claude and Evidence are
optional and are not invoked by this path. Patient cloud stays OFF.

## Resource policy

`services/imaging-ai/resource_guard.py` is a pure calculator. All dimensions and
frame counts must first pass the existing request validation. The worker chooses
the profile; a browser cannot lower its limits through the job request.

For **Safe Mode** (default):

* Model estimate = 704 MiB + 8 × voxels bytes + 32 × frames × 256 × 256 bytes
  + 12 × native-plane pixels bytes.
* Required available RAM = model estimate + 384 MiB.
* RSS ceiling = min(2 GiB, model estimate + 128 MiB).
* Disk = NIfTI headers + float32 input + uint8 mask + 128 MiB temporary reserve.

The fixed allowance covers framework/net/workspaces; the native-volume term
accounts for the mapped input, uint8 output and spare capacity. Native-plane
temporaries and compact-volume connected components have separate allowances.
Coefficients are deliberately **provisional**, based on inspected allocations,
measured Linux execution and the earlier Mac reference result, not complete
near-threshold M1 calibration or a clinical guarantee.
The model estimate + 128 MiB must fit the absolute ceiling even if RAM is plentiful.
Many tiny slices can exceed the per-frame budget despite fitting the voxel cap.

| Profile | Threads / inter-op / batch | Fixed allowance | Volume term | RAM margin |
|---|---|---|---|---|
| `safe` (default) | 1 / 1 / 1 | 704 MiB | 8 bytes per voxel | 384 MiB |
| `balanced` (explicit worker startup only) | 2 / 1 / 1 | 896 MiB | 32 bytes per voxel | 512 MiB |

Both profiles add 32 bytes per compact 256×256 voxel and 12 bytes per native-plane
pixel. Balanced retains a larger conservative allowance for parallel CPU work.

For the **partial native 512×512×32 reference**, Safe requires **1219 MiB** available
RAM, sets **963 MiB** model RSS ceiling and reserves about **168 MiB** disk. It does
not extrapolate this slab to full chest. No hidden crop, resampling, skipped
postprocessing or lower-precision model is substituted to force admission.

Resources are checked when a job is admitted and **again before inference**,
after hashing/upload. Runtime monitoring kills/reaps the child on its RSS ceiling,
timeout or three consecutive available-RAM readings below 256 MiB (~0.6 s nominal).
The child also checks its own RSS/high-water every 20 ms. These are best-effort
process controls, not OS memory reservations or a promise of no swap/system stall.
At the second disk check, the already stored input is subtracted from the required
free disk budget; it is not reserved twice.

Safe child environment sets OMP/MKL/OpenBLAS/Accelerate/NumExpr and Torch
intra/inter-op threads to one, CPU batch to one and POSIX nice to +5. Optional
oneDNN/IDEEP primitive cache capacities are set to one; builds without those
backends ignore them. Provider secrets and session token are not inherited.

`r231_inference.py` clips/crops/normalizes one native slice at a time and fills a
preallocated compact uint8 label volume. Reconstruction fills a single native
uint8 mask, without a native float64 slice list or repeated `vstack` allocations.
The pinned whole compact-volume postprocessing remains intact: it is **not**
run independently per slice/slab. Native geometry, model resolution and float32
precision are unchanged; this is not complete-chest support beyond existing caps.

UNet initialized storage is discarded before loading the official checkpoint;
`assign=True` avoids a simultaneous second weight copy. Unused residual branches
are released only after strict state loading (`residual=False`). Inference ReLUs
operate in place, skip connections are released after their last use, and model
weights are released before connected-component postprocessing.

Importing upstream `lungmask` eagerly loads SimpleITK and DICOM readers even for
an already decoded NumPy input. The child instead loads the SHA-verified installed
`resunet.py` directly and uses the six unchanged segmentation functions in
`r231_lungmask_utils.py`, with source attribution and Apache-2.0 licence included.
No SimpleITK/pydicom reader is imported for inference. Optional dependency/version
checks remain; a modified architecture file is rejected. Medical weights/dataset
licence clearance is separate from this code licence.

## Errors and retry

* HTTP 507 with `detail.code=insufficient_memory` or `insufficient_disk` includes
  `detail.preflight`. Failed admission creates no job directory or occupied slot.
* `model_memory_budget_exceeded` requires a smaller **explicit** research selection,
  rather than silently lifting a guard. `model_not_ready` is HTTP 503.
* Token/origin remain HTTP 401/403. Browsers can mask a denied-origin reply as
  a transport/CORS failure; the UI explicitly describes that ambiguity.
* Runtime failed statuses identify memory pressure, RSS ceiling or timeout.
  The client attempts DELETE before surfacing an error, preserving the existing
  TTL fallback if the connection is lost.

The UI shows available/required RAM or disk and relevant recovery steps. After
an error, **Повторить R231** repeats readiness and resource checks without
reloading the page, losing the selected CT or changing the session token.
No automatic retry loop or cloud fallback is introduced.

Successful status `metrics` contains `preflight.availableRamBytes`,
`preflight.requiredRamBytes`, `guardDecision`, `peakRssMiB`, profile and thread
counts. Preflight is the snapshot before inference. Runtime pressure additionally
records `preflight.runtimeAvailableRamBytes`. Peak is the maximum of child
sampling/high-water and worker polling; system/browser/controller RAM is separate.

The real browser checker also writes a **failed** diagnostic JSON after a browser
job failure, with allowlisted numeric resource information only. It exits nonzero;
this JSON is never a PASS. Failure before reference/preflight setup can still occur
without a report. Never collect raw Playwright exception text, session headers,
PHI, DICOM pixels or screenshots from a real study.

## Reproduce

Existing optional environment/checkpoint need no reinstall:

```bash
bash scripts/start-local-lungmask.sh --profile safe
```

First install on a Mac whose system Python is newer than the pinned stack:

```bash
bash scripts/start-local-lungmask.sh --install --accept-research-license --python python3.11
```

An existing `.venv-lungmask` is used for installation/version checks. `.env.local`
is never modified. For automatic browser verification, stop the manual worker;
the checker starts a separate authenticated Safe worker on its own free port.

```bash
.venv-lungmask/bin/python -m pip install -r services/imaging-ai/requirements-dev.txt
.venv-lungmask/bin/python -m pytest services/imaging-ai -q
(cd web && npm test && npm run typecheck && npm run build && npm run test:browser)
bash scripts/test-r231-browser.sh --download-public-reference
```

The browser regression exercises synthetic memory/disk/model failures, UI retry
without reload and exact mask binding/MPR. It is not real-model evidence. The
opt-in real checker uses the pinned public 32-of-103 native-slice reference.

## Previous verification on Linux (before streaming; not M1 acceptance)

[Technical report](verification/r231-safe-mode-linux.json): actual official R231
on the unchanged public 32-of-103 LCTSC reference, CPU Safe Mode, one thread.

* 257 chunks / 33,554,784 input bytes; source/weight/mask SHA and grid verified.
* Both labels and all three MPR overlay planes verified; job deleted, GET 404.
* Inference/postprocessing 36.995 s; adapter 38.382 s; peak model RSS 856.11 MiB.
* Pre-inference required RAM 1496 MiB, observed available RAM about 8.13 GiB,
  `guardDecision=allow`. This did **not** simulate a near-threshold M1 run.
* Mask SHA and label counts match the previous trained-model browser reference.
* 42 Python tests, 167 Web tests, typecheck/build and synthetic browser retry
  across RAM/disk/model errors pass. A separate model-unavailable browser check
  exits nonzero and writes a failed diagnostic report.

One thread reduced parallel CPU demand; these previous measurements did not demonstrate
a lower peak RSS or establish a controlled comparison with the old two-thread
run. Streaming allocation changes below supersede that implementation. M1
coefficients still need calibration.

## Streamed R231 verification on Linux (not new M1 acceptance)

[Comparison report](verification/r231-low-memory-linux.json): same official
checkpoint and unchanged public 32-of-103 native LCTSC reference, one CPU thread,
batch one. A same-session baseline adapter at main `ebe7ca2` measured **828.05 MiB**
peak; the optimized adapter in the actual browser test measured **701.77 MiB**,
a **126.28 MiB / 15.25%** reduction. Both use getrusage process high-water RSS.

* Exact input and complete mask SHA match the baseline; labels `[7703880,337031,347697]`.
* Actual trained inference, 257 chunks / 33,554,784 bytes, three MPR planes, DELETE/404 pass.
* New inference/postprocessing 36.131 s; adapter 37.376 s; browser test 47.672 s.
* Required RAM decreases from 1496 to 1219 MiB (18.52%); RSS ceiling is 963 MiB.
* The 384 MiB admission margin, 256 MiB runtime system reserve, absolute 2 GiB
  ceiling, timeout/cancellation, single slot and voxel/MPR caps are retained.
* A unit/API regression admits the user's reported 1318.625 MiB snapshot using
  the new budget. This **does not** claim an actual near-threshold Mac inference.
* 48 Python tests pass with the optional stack, including exact preprocessing,
  postprocessing and optimized forward equivalence. Optional stack checks skip
  in the base-only environment; trained weights are not included in CI.

The earlier Mac browser PASS used the previous adapter (709.86 MiB model RSS);
do not compare that number with Linux to claim a Mac reduction. New Mac memory,
swap and responsiveness measurements are still required. Existing environments
and official weights need no reinstall or re-download. Stop any old manual worker
and restart it from this feature branch before testing.

## Remaining acceptance

Native Mac M1 8 GB (available RAM, compressor/swap, whole-system/browser/controller
memory, repeated runs, cancellation), Safari, complete native chest CT beyond
current limits and independent manual-contour/clinical accuracy remain pending.
Lower CPU priority/thread count can increase elapsed time. Memory pressure from
other apps can still reject or terminate an otherwise valid job. R1 is PARTIAL;
patient analysis and remote patient/cloud routes remain blocked.
