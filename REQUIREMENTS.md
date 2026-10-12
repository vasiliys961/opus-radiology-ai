# OPUS RADIOLOGY AI — PRODUCT REQUIREMENTS (PRD)
**Version 2.0 · 2026-10-11 · binding checklist for future coding sessions.**

Canonical vision and implementation truth: **[docs/OPUS_RADIOLOGY_MASTER_SPEC.md](docs/OPUS_RADIOLOGY_MASTER_SPEC.md)**. All paths and status below must be revalidated against current GitHub \`main\` before each PR. Priority \`P0\` blocks patient use or safety; \`P1\` core function; \`P2\` extensions.

## How to interpret the status

- \`IMPLEMENTED\` — exists in \`main\` with code and tests; not necessarily clinically validated.
- \`PARTIAL\` — some code exists, complete user scenario not yet implemented.
- \`PLANNED\` — contractual target; no claim of functioning.
- \`BLOCKED\` — feature may not be enabled until privacy/security/clinical gates are verified.

| ID | Priority | Requirement / Acceptance criteria | Status (2026-10-11) |
|---|---|---|---|
| VIEW-01 | P0 | Browser DICOM study import with explicit unsupported/invalid file handling; no unsolicited pixel upload. | IMPLEMENTED (bounded format/codec support) |
| VIEW-02 | P1 | 2D/MPR/3D with real geometry, orientation, windows and reliable review of original slices. | IMPLEMENTED for eligible studies, unvalidated clinically |
| VIEW-03 | P1 | Audit **all** series: technical readiness, sequence uncertainty, coverage limitations, errors; click through series. | IMPLEMENTED (Study Intelligence) |
| VIEW-04 | P1 | Multi-series task gating: T1/T1c/T2/FLAIR, DWI/ADC and multiphase CT only after evidence from actual tags/pixels. | PARTIAL (simple tag heuristics only) |
| DATA-01 | P0 | Export exact selected 3D volume, source/series geometry, checksums and model-compatible full-resolution scalars; never use windowed PNG as quantitative source. | IMPLEMENTED to 8,388,608 voxels |
| DATA-02 | P0 | Stream **large** CT/MRI (e.g., 512×512×300) via chunking/mmap without 8GB OOM; preserve voxel spacing, LPS/RAS, HU, SOP provenance and cancellation. | PARTIAL — bounded local upload; native large-volume viewer/model/mask pipeline pending |
| DATA-03 | P0 | Result returns with original study/series/frame coords and source identity; reject mismatched or fabricated masks. | IMPLEMENTED for existing NIfTI mask import; richer findings PLANNED |
| EXEC-01 | P1 | Browser-only lightweight model via WASM without Python; must expose actual runtime compatibility and fail to unsupported. | PLANNED |
| EXEC-02 | P1 | \`127.0.0.1\` local-worker with versioned job contract, capabilities, model registry, uploads in bounded chunks, cancel/progress, authenticated browser origin and zero external patient egress by default. | PARTIAL — bounded authenticated loopback R231 research worker; patient/remote/large-volume modes blocked |
| EXEC-03 | P1 | Real model inference on Mac: CPU ONNX now; Torch CPU/MPS, MONAI, Lungmask, TotalSegmentator behind explicitly installed weights/adapters. | PARTIAL — actual R231 partial-reference browser/HTTP regression; streamed adapter has user-supplied instrumented Mac partial-reference PASS; M1 memory/response acceptance pending; generic ONNX remains synthetic |
| EXEC-04 | P1 | Private CPU server and GPU worker use the same input/output and audit, with queued isolated jobs and measured RAM/VRAM. | PLANNED |
| EXEC-05 | P0 | Resource preflight (estimated peak memory, space, time) + concurrency cap 1 on 8GB Mac, fallback to smaller ROI/CPU if valid, cancellation without leaking buffers. | PARTIAL — streamed R231 native-plane operations, one weight allocation, bounded compact-volume postprocessing, adaptive volume/frame/plane estimate, one job, RSS/system-pressure/timeout/cancel and UI retry; Linux RSS reduction verified; instrumented streamed-adapter Mac functional PASS, memory/response acceptance pending; see docs/R231_SAFE_MODE.md |
| MODEL-01 | P0 | Each model has verified version/sha/license, modalities, sequences, input intensity and geometry transform, preprocessing and test data; unknown => unsupported. | PARTIAL (ONNX profile + pinned R231 adapter; commercial weights/data clearance pending) |
| MODEL-02 | P1 | First real end-to-end chest CT: Lungmask R231 → actual mask/measurements in MPR on permitted open reference study; memory/time benchmark on M1. | PARTIAL — actual partial LCTSC R231→browser MPR on Linux and instrumented streamed-adapter Mac report; identical mask; full chest/Safari/M1 memory/response acceptance pending |
| MODEL-03 | P1 | TotalSegmentator CT/MR in correctly licensed tasks, CPU/MPS and \`--fast\`/ROI, no universal lesion-detection claims. | PLANNED |
| MODEL-04 | P1 | Specialty detectors/segmenters for lung nodules, abdominal organs, brain MRI BraTS, other supported localizations, with original task-specific checks. | PLANNED |
| MODEL-05 | P1 | Reject unrelated study/model combinations; a model that cannot see a structure never outputs 'no pathology'. | PARTIAL; full model routing planned |
| EVID-01 | P0 | Structured JSON with model/version/source/ROI/coordinates/units/findings and known missing evidence; no invented anatomical measurements. | PARTIAL — bound specialist/LLM comparison JSON plus local printable HTML report separating measurements, hypotheses, abstention and review history; provenance/coverage remains unverified |
| EVID-02 | P1 | Spatial reconcile network masks/findings and LLM assertions, independent conflict checking; show exact source slices; physician corrections are versioned. | PARTIAL — specialist review, label-volume differences/abstention, bound LLM LPS point QC/navigation and local versioned review journal/export/restore; full ROI reconciliation, authenticated independent inference and protected physician audit PLANNED |
| LLM-01 | P1 | Optional LLM adapters: Gemini, Claude Opus, GPT and permitted open-compatible models; API keys server side; real credentials tested only in user environment. | PARTIAL (OpenRouter synthetic only, Polza diagnostic) |
| LLM-02 | P0 | LLM is **not necessary** for full offline viewer/AI tasks and may never silently substitute for missing specialist model. | PARTIAL architectural constraint |
| LLM-03 | P1 | Parallel Vision/model calls under budget, transparent 'what was actually seen' ledger, structured comparison, independent critique and evidence review. | PARTIAL (synthetic pipeline only) |
| PRIV-01 | P0 | Real patient cloud egress remains hard OFF until server-verified auth, lawful purpose, de-ID tags + pixel checks, retention, processor contract/jurisdiction and audit; no client checkboxes overriding. | IMPLEMENTED OFF gate / production policy PLANNED |
| PRIV-02 | P0 | Local patient analysis isolated: loopback-only worker, access control, no analytics/PHI logs/CI, local encrypted patient storage if persisted, audit and lifecycle deletion. | PARTIAL — research-only loopback boundary; clinical patient storage/access/audit not released |
| PRIV-03 | P0 | Server patient mode: TLS, role-based access, tenant isolation, encryption, authenticated jobs, limited retention, documented applicable jurisdiction, private provider agreements. | PLANNED |
| COST-01 | P1 | **No mandatory subscriptions** or paid APIs to operate browser, offline AI and local evidence; code/weights licenses independently verified. | PARTIAL (core OSS components) |
| COST-02 | P0 | For optional paid models: preflight costs and frame/token limits, explicit approval, daily/monthly hard cap, idempotent billing, retry controls and kill switch. | PARTIAL (synthetic throttles; production budget PLANNED) |
| COST-03 | P1 | Per-model/licensed-weights record of access restrictions, countries, commercial status and software versions; MedGemma excluded per project constraint. | PLANNED |
| REVIEW-01 | P0 | Every generated clinical text is an **unverified draft** until signed by authorized clinician; one-click study-linked evidence review. | PARTIAL — bound local journal/restore, printable report and separate versioned reviewer text with stale-review warning; authenticated clinician identity, protected persistence and signature PLANNED |
| REVIEW-02 | P0 | No marketing claim of sensitivity/specificity/clinical validity without independent held-out evaluation on each anatomical task. | Policy implemented; clinical validation PLANNED |
| OPS-01 | P1 | Next.js UI deploys independently of Python; same interface can be used browser-only / local Mac / remote CPU / remote GPU. | PARTIAL |
| OPS-02 | P1 | Reproducible Docker/venv/container images and task-specific minimal dependency sets; no automatic 15 GB medical model download on M1. | PARTIAL (base requirements provided by this PR) |
| OPS-03 | P1 | GitHub CI for every changed adapter with both positive and negative fixtures, full real CPU/GPU inference when feasible, browser regression and perf checks. | PARTIAL |
| OPS-04 | P0 | User's \`web/.env.local\` never copied/committed/overwritten; no direct \`main\` push or automatic merge. | Nonnegotiable workflow |

## Releases and acceptance milestones

**R1 / first working real model (next):** install verified Lungmask R231 in an isolated Python environment; new local \`127.0.0.1\` AI worker and browser action for authorized open/test chest CT; segment actual nonpatient reference CT; import masks into MPR; preserve exact LPS/spacing and model SHA; display measured CPU/MPS time and peak memory on M1/8GB; reject unsupported CT; zero cloud egress. A CLI-only demo or a fake mask does **not** pass.

**R2 / broaden anatomy:** TotalSegmentator CT/MR with correct regional subset and provenance, plus tests for unsupported sequences/coverage. Do not require pretrained models on initial npm or base Python installation.

**R3 / scale:** large study streaming and CPU/GPU private deployment; avoid duplicating entire volume in browser memory. A job can fail with unsupported before allocating excessive RAM.

**R4 / pathology detectors:** MONAI/nnU-Net on well-specified CT/MR tasks (lung nodules, brain tumor, abdominal lesions, musculoskeletal targets etc.), location/source-linked results, label dictionary and independent retrospective metrics.

**R5 / hybrid AI:** optional parallel Gemini/Claude/GPT and specialist models, evidence critique, source verification and adjustable spend. Clinical/PHI egress cannot activate until independently verified privacy gate.

**R6 / clinical product:** physician authorization/reports/audit, regulation and independent diagnostic validation in the selected jurisdiction. No date or approval status is implied by the roadmap.

## Required negative tests before accepting any connected model

- Wrong/missing modality, unknown MRI sequence or mismatched DICOM frame of reference.
- Mixed series/duplicate SOP, inconsistent spacing, wrong orientation/coordinate transform.
- 8GB Mac OOM, cancelled job, corrupted model file or changed SHA, unavailable/busy server.
- Model output empty/incompatible → **not** 'normal study'.
- Expired/not-licensed/restricted checkpoint → cannot auto-download or run.
- User file with patient name/pixel burn-in → cannot be sent to unauthorized cloud; no PHI in logs.
- Wrong source/result binding, replayed previous job, unauthorized browser origin.
- Unknown cloud pricing, out-of-credit account, duplicate retry, provider/model unavailability.
- Clinical reviewer rejects AI; report must preserve correction and no false final status.

## Developer contract

See [AGENTS.md](AGENTS.md) and [docs/OPUS_RADIOLOGY_MASTER_SPEC.md](docs/OPUS_RADIOLOGY_MASTER_SPEC.md). Use **only existing** workflow and tests as evidence of completed behavior. Every PR must state what works, what remains blocked, what is synthetic, hardware benchmark if made, licensed checkpoint provenance and exact tested commands. Merge remains manual.

## R1 engineering increment — 2026-10-11

See [local worker](docs/LOCAL_LUNGMASK_WORKER.md) and [verification record](docs/R1_LUNGMASK_VERIFICATION.md). Real R231 ran on the authors' two public CT slices through authenticated loopback HTTP. Browser contract/MPR regressions remain synthetic; a complete native-resolution chest/R231→MPR/Safari/M1 test has not been performed. Do not mark R1 complete or infer clinical Dice from reproducibility voxel counts. Four modes remain the architecture; remote CPU/GPU and browser WASM are not enabled by this increment.


## Bounded local upload increment — 2026-10-11

On baseline main `6ae278b6cdf678cae9e0b92c0777bd5c3b05043a` (PR #13 merged),
local R231 browser submission now serializes exact float32 NIfTI in two passes:
incremental SHA-256 then sequential acknowledged 128 KiB blocks. No whole-volume
export buffer/Blob is allocated by this local action; manual download still uses
the existing full buffer. Worker commits only complete, SHA-bound inputs and
rejects replay/concurrent writes. Cancellation deletes/reaps, including mid-upload.
Browser mask download enforces declared bytes while reading.

**DATA-02 remains PARTIAL for transport only**, not large-study acceptance:
8,388,608 voxel and 48 MiB MPR raw-volume guards remain unchanged. Cornerstone
still holds its decoded volume, returned masks still allocate a complete label
array, and upstream Lungmask preprocessing/postprocessing can hold full-volume
copies. Native full chest, bounded whole pipeline, actual R231 browser overlay,
Safari/M1 8GB system memory and independent clinical metrics remain pending.
Four modes, optional Gemini/Claude through Evidence and patient/cloud OFF remain
unchanged. See `docs/R1_LUNGMASK_VERIFICATION.md` for separately labelled actual
model results and synthetic browser tests. R1 is still PARTIAL.


## Actual browser R231 increment — 2026-10-11

On baseline main `cfacb95e4610cb1d9e1bc15c1edf6b9bdad4f34c` (PR #14 merged),
a reproducible opt-in test now verifies **actual trained R231 → browser MPR**
on 32 unchanged native consecutive CT slices from the public TCIA LCTSC dataset
(CC BY 3.0), explicitly selected from 103 original slices. Exact independently
calculated full scalar input SHA, source grid, real model/mask binding, both lung
labels, all three rendered MPR planes and job deletion were verified on Linux.
No real reference pixels/screenshots, raw source identifiers or tokens are stored
in GitHub/CI artifacts; only technical verification JSON. Default CI is synthetic.

**R1 remains PARTIAL**: this is a declared partial slab, not complete chest.
No full lung-volume, manual-contour Dice, M1/Safari/total system RAM or clinical
accuracy acceptance. The 8,388,608-voxel and 48 MiB MPR guards stay unchanged.
The UI explicitly warns that mask volume refers only to loaded slices. Four
execution modes and specialist + optional Gemini/Claude through Evidence remain
the architecture; cloud/patient/remote gates stay closed.

See `docs/R231_BROWSER_REFERENCE.md` and the measured technical report at
`docs/verification/r231-browser-linux.json`. After the optional environment and
checkpoint are installed, reproduce with:
`bash scripts/test-r231-browser.sh --download-public-reference`.


## Mac resource report and tensor lifetime follow-up — 2026-10-11

PR #17 is merged into main `490fec3`; its Python Actions are green. A new
user-supplied Mac M1/8GB run of the streamed implementation passes actual R231,
257 chunks, identical full mask SHA, three MPR overlays and job deletion. Model
high-water is **752.97 MiB**, not a demonstrated improvement over the earlier
709.86 MiB Mac run. System minimum available RAM is about 1127.61 MiB; swap peaks
102.8125 MiB above its starting value and ends 30.8125 MiB higher. All tracked
process groups are zero during the completed 30-second post-observation. UI
responsiveness was not assessed. Original reports contain no commit SHA. See
`docs/verification/r231-low-memory-mac.json`.

The follow-up releases upsampling/cropped-skip/block-input tensors before later
convolutions, using the same pinned residual=False Sequential operations. Exact
logits and tensor lifetime tests plus actual public-reference browser verification
are required. Keep Safe thresholds unchanged: functional Mac PASS does not
accept memory reduction, repeated-run responsiveness, Safari, full chest or
clinical accuracy. Four modes/Evidence/optional LLM and patient/cloud OFF remain.


Follow-up validation: 49 Python tests pass with the optional stack. Two fresh
sequential adapter runs on the same Linux host/reference/checkpoint measure
763.51→596.06 MiB model peak (21.93%). Both include getrusage high-water; the
baseline uses the PID namespace fallback, while the optimized run also samples
psutil RSS. The separate actual browser run passes at 636.20 MiB, with identical
mask SHA, three MPR planes and job deletion. This is a single measured comparison,
not a Mac reduction claim. Safe admission remains 1219 MiB. See
`docs/verification/r231-tensor-lifetime-linux.json`.
