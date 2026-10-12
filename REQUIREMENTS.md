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
| PRIV-01 | P0 | Real patient cloud egress remains hard OFF until server-verified auth, lawful purpose, de-ID tags + pixel checks, retention, processor contract/jurisdiction and audit; no client checkboxes overriding. | IMPLEMENTED OFF gate; bounded local pixel-only copies, PNG metadata stripping, RU/EN OCR text localization, actual raster redaction and SHA-bound manual review with bounded local journal/export/restore and local readiness status PARTIAL; independent de-ID/server authorization/production policy PLANNED |
| PRIV-02 | P0 | Local patient analysis isolated: loopback-only worker, access control, no analytics/PHI logs/CI, local encrypted patient storage if persisted, audit and lifecycle deletion. | PARTIAL — research-only loopback boundary; clinical patient storage/access/audit not released |
| PRIV-03 | P0 | Server patient mode: TLS, role-based access, tenant isolation, encryption, authenticated jobs, limited retention, documented applicable jurisdiction, private provider agreements. | PLANNED |
| COST-01 | P1 | **No mandatory subscriptions** or paid APIs to operate browser, offline AI and local evidence; code/weights licenses independently verified. | PARTIAL (core OSS components) |
| COST-02 | P0 | For optional paid models: preflight costs and frame/token limits, explicit approval, daily/monthly hard cap, idempotent billing, retry controls and kill switch. | PARTIAL (synthetic throttles; production budget PLANNED) |
| COST-03 | P1 | Per-model/licensed-weights record of access restrictions, countries, commercial status and software versions; MedGemma excluded per project constraint. | PLANNED |
| REVIEW-01 | P0 | Every generated clinical text is an **unverified draft** until signed by authorized clinician; one-click study-linked evidence review. | PARTIAL — bound local journal/restore, printable report and separate versioned general/label reviewer text with stale-review warning and existing-label MPR navigation; authenticated clinician identity, protected persistence and signature PLANNED |
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


## Label-linked reviewer drafts — 2026-10-12 (feature branch)

Baseline main `dcaf69b` has PR #24 manually merged and green Web Actions.
The existing local note journal now keeps independent latest general/label text.
Optional observation IDs must match current specialist Evidence exactly. Targeted
journals use v2 so older clients refuse instead of misattributing label comments;
older v1 general files keep their shape and prefix. MPR navigation reuses the existing
occupied-label point, not an invented lesion/ROI. Unsaved edits block target
switching and full exports. HTML retains latest text and stale/cleared state per
target. Review changes conservatively stale all targets; reconfirmation is per
target. The shared cap remains 32 versions total, not 32 per label.

See `docs/REVIEWER_NOTE.md`. This is metadata-only unsigned research text, not
clinical approval, protected storage or an authenticated audit. No model rerun,
volume copy, resource-guard change, .env.local change or patient/cloud/remote
activation. Four modes and R1/Mac/Safari/full-chest/clinical boundaries remain.


## Local cloud privacy preparation — 2026-10-12 (feature branch)

Baseline main `335d6d3` includes manually merged PR #25 and green Web Actions.
The user's next goal is cloud analysis only after de-identification. The local
Vision plan now prepares bounded windowed PNG copies without DICOM/private
metadata, original UIDs/filenames or clinical/reviewer text. PNG ancillary blocks
are stripped with CRC/size/encoding checks; actual opaque-black raster redaction
leaves source/MPR/Evidence untouched. Each exact copy needs separate local text/
visual checks bound to its SHA; redaction/restart resets review. Explicit local
candidate export only, no network or provider/model run.

This is PARTIAL privacy preparation, not a trusted de-ID release or DICOM file
conformance claim. The candidate retains unverified/sampled-only and transmission
false. OCR/defacing, independent privacy acceptance, server clinician/study
controls, provider context and audit/retention remain pending; arbitrary `/api/ai`
stays HTTP 410 and forged client flags cannot enable it. See
`docs/CLOUD_DEIDENTIFICATION.md`. Four modes, optional-LLM Evidence separation,
.env.local, all R231/MPR/resource guards and R1 acceptance stay unchanged.


## Local privacy OCR assistance — 2026-10-12 (feature branch)

Baseline main `d48f7ff` includes manually merged PR #26 and green Web Actions.
Privacy copies now support opt-in actual Tesseract RU/EN text localization,
SHA-bound native rectangles and batch raster redaction. Recognized strings remain
in ephemeral workers; only coordinates/uncalibrated OCR confidence reach UI.
Positive detections require hiding or an explicit local non-identifying-text
acknowledgement; counts are retained. Re-scan/image changes revoke prior marks;
zero detections never authorize cloud or complete human review.

Pinned code/core/language assets are served as verified static same-origin GETs,
not a pixel upload endpoint. No CDN, persisted OCR/image cache or provider call.
One same-tab slot serializes OCR and R231; owned workers stop on cancel/source
replacement/failure/30-second timeout. This is not cross-tab/OS memory admission
or an M1/Safari benchmark. All existing worker/resource/MPR/SHA guards remain.
See `docs/LOCAL_PRIVACY_OCR.md` for pins, licensing, tests and pending independent
privacy/server release. Four modes, optional LLMs through Evidence, .env.local,
patient/cloud/remote OFF and R1 boundaries remain unchanged.


## Local privacy review journal — 2026-10-12 (feature branch)

Baseline main `28be9d8` includes manually merged PR #27 and green Web Actions.
Bounded local history now records copy SHA changes/rectangles, OCR start/result/
cancel/failure and explicit human decisions. Replay checks current exact PNGs,
redactions and review state before exports. Separate metadata-only journal and
reviewed copy+journal bundle downloads complement the unchanged candidate format.
No recognized text, original UIDs, patient/context text, token or error text is
recorded. Capacity is 128 events; OCR reserves a terminal slot. Restart creates a
new session; no silent truncation, automatic persistence or import is added.

This is unsigned sampled-copy history with an unverified clock/actor, not clinical
source verification, protected audit or a trusted de-ID release. Server/privacy/
provider acceptance remains pending; patient cloud remains OFF and `/api/ai` 410.
See `docs/PRIVACY_REVIEW_JOURNAL.md`. Four modes, optional-LLM Evidence separation,
.env.local, R231/Safe/MPR guards and R1/Mac/Safari/full CT boundaries remain.


## Local privacy bundle restoration — 2026-10-12 (feature branch)

Baseline main `42ea468` includes manually merged PR #28 and green Web Actions.
Local reviewed copy+journal files now restore onto matching current initial
previews after bounded PNG/SHA/replay/digest checks and sequential cancellable
decoding. Nonempty current history requires an exact same-session prefix;
older/forked/foreign files and failures leave current work intact. Restore
preserves raster redactions/history and appends v2 reset events, clearing both
human checks and transient OCR/acknowledgement. Re-review is required for export.
Native v1 files remain unchanged; new clients accept full v1/v2 bundles.

This is explicit local restoration, not protected storage/authenticated provenance
or trusted de-ID. No patient cloud release, server upload, model rerun, volume
allocation, .env.local change or guard relaxation. Four modes, specialist/optional
LLMs through Evidence and R1/Mac/Safari/full CT/clinical boundaries remain. See
`docs/PRIVACY_REVIEW_JOURNAL.md` for versioning, limits and verification.


## Preferred Vision/evaluator routing — 2026-10-12 (feature branch)

Baseline main `5f65cfe` includes manually merged PR #29 and green main Web Actions.
The user's exact Gemini 3.8 Flash + chosen Sonnet 5.5/Opus 5.5/GPT-6.1 Sol profile
now replaces alphabetic catalogue examples in the synthetic browser trial.
One main selection drives the selected Polza/OpenRouter gateway; missing exact
models/modalities refuse without downgrading. Polza's documented metadata API is
connected. The chosen evaluator, rather than Vision itself, runs the image critic
and text synthesis. Five calls and existing cost guards remain; cancel/selection
changes abort client/server requests and stale results are discarded.

Public catalogue presence is not account access or radiological accuracy. Paid
completions are mocked in verification; no patient data/new paid test/medical
model rerun, .env.local change, cloud release or guard relaxation. Four modes and
specialist/optional-LLM Evidence separation remain. See `docs/PREFERRED_AI_MODELS.md`.


## Local privacy preparation readiness — 2026-10-12 (feature branch)

Baseline main `4473328` includes manually merged PR #30 and green Web Actions.
Each sampled copy now shows SHA-bound optional OCR, both human marks and redaction
count; busy/stale/unreviewed states remain distinct. Seven server policy checks
are shown separately as unconnected. On-demand metadata-only readiness export
validates exact PNGs/current journal; it never serializes pixels, words, PHI,
tokens or raw history, and cloud/de-ID flags always remain false.

Rendering does not decode/hash/copy images or run models/network. This is an
unsigned local snapshot, not trusted privacy acceptance or server authorization.
No new paid call/patient transfer/.env.local change or guard relaxation. Four
modes, specialist/optional-LLM Evidence separation and R1/Mac/Safari/full CT
boundaries remain. See `docs/LOCAL_PRIVACY_READINESS.md`.
