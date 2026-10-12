# Opus Radiology AI — Instructions for Future Chats, Cursor and Coding Agents

**Single source of truth:** [docs/OPUS_RADIOLOGY_MASTER_SPEC.md](docs/OPUS_RADIOLOGY_MASTER_SPEC.md) and [REQUIREMENTS.md](REQUIREMENTS.md). These are product goals, NOT claims that every feature works now.

Before any implementation: inspect live GitHub \`main\`, its CI status, branch diff, installed checkpoints and user-reported Mac results. Keep source-backed "implemented" separate from "planned".

## Nonnegotiable architecture

- **Browser-first:** Next.js + React + Cornerstone DICOM viewer, 2D/MPR/3D, multi-series protocol QA, source-linked Evidence, physician review.
- **Four modes:** in-browser lightweight ONNX WASM; local Python ONNX/PyTorch CPU/MPS; private CPU worker; private GPU worker. Same job/evidence contract and browser interface; no mandatory paid subscriptions or closed models.
- **MacBook Air M1 / 8 GiB** is the first benchmark target. Current NIfTI export has **8,388,608 voxel limit**. Never simply raise it: use memory-bounded streaming, ROI and tiling, verify source geometry.
- **Specialist vision**: Lungmask R231, TotalSegmentator, selected MONAI/nnU-Net checkpoints; each requires its own license, modality/sequence support, weights SHA and benchmark. Open source *code* does not mean that all model *weights* permit commercial use.
- **LLM layer:** Gemini, Claude Opus, GPT or legally usable open models are optional. Expert models and LLM may work in parallel, but conflicting output stays visible. No invented diagnoses or "normal" findings when source/model unsupported.
- **MedGemma excluded** under the user's regional/licensing constraints.

## Current verified boundary (2026-10-11)

PRs #6–#14 are merged into `main`. DICOM/Cornerstone/MPR/3D, Study Intelligence,
NIfTI package/mask import, experimental ONNX CPU runner **with synthetic Identity
weights**, OpenRouter **with generated nonpatient PNGs**, and the opt-in real R231
research-only CPU loopback worker/browser action exist. Checkpoints are installed
separately; they are not included in the repository. Actual R231 was verified on
two public CT slices over HTTP on Linux, not complete chest/M1/browser acceptance.
No clinically validated universal pathology detector exists.

Next **R1**: legally cleared complete native chest CT, actual R231 mask in MPR,
bounded viewer/model/mask memory and Mac M1/8GB/Safari benchmark. Keep existing
limits until whole-pipeline evidence supports larger inputs. Do not claim that
chunked transport alone completes large-study support or R1.

## Patient safety, cost, workflow

- Patient upload to external model remains blocked; \`/api/ai\` returns HTTP 410; only synthetic provider experiments enabled. Never enable by the presence of \`OPENROUTER_API_KEY\`. Require clinician access, lawful basis, audited tag+pixel privacy, authorized processing, jurisdiction/retention and clinical review.
- Do not place DICOM, PHI, screenshots with patient data or secrets in GitHub, logs, CI or analytics. Keep local worker loopback-only with origin/session controls.
- Existing \`web/.env.local\` contains user's key: NEVER show, overwrite, commit, upload or replicate it. Never use obsolete \`Downloads/install-opus-radiology-ai.sh\`.
- Cost caps / budgets / cancel and model availability must be real, not mock; LLM providers may be regionally unavailable and must never be prerequisites for offline mode.
- Python dependencies are in root \`requirements.txt\` and separate \`services/imaging-ai/requirements-*.txt\`. Next.js uses \`web/package.json\`. Heavy PyTorch/MONAI stacks are opt-in only.
- Use **feature branches and manual PR merge**. No push straight to \`main\`; no auto-merge. Show actual commands, checks and open PR links. Preserve working DICOM/MPR/3D and browser tests. No success signal before real validated completion.

## Paste into a new chat

> Продолжай проект Opus Radiology AI по \`docs/OPUS_RADIOLOGY_MASTER_SPEC.md\`, \`REQUIREMENTS.md\` и \`AGENTS.md\`. Сначала проверь реальный GitHub \`main\`, CI и состояние модели. Приоритет R1: настоящий Lungmask R231 на легальной исследовательской КТ грудной клетки, локальный AI Worker и возврат маски в MPR на Mac M1/8 GB. Реальные пациенты не отправляются в облако. Не меняй \`.env.local\` и не сливай PR сам. Разделяй готовые возможности и планы.

## R1 engineering increment (verify the branch/CI, do not assume full acceptance)

`services/imaging-ai/worker.py` + `r231.py` now provide an opt-in bounded research
loopback CPU path and browser action. Actual official R231 weights/two public CT
slices were tested on Linux, including real HTTP job/upload/result/delete.
Default browser tests are synthetic. Export remains capped at 8,388,608 voxels.
R1 is still PARTIAL: full chest, actual R231 browser overlay, Safari/M1 8GB system
memory, clinical metrics and commercial model/data licence clearance are pending.
Do not replace these missing checks with resampling, repeated slices or fabricated
Dice. Local patient mode, remote workers and patient cloud remain blocked. See
`docs/LOCAL_LUNGMASK_WORKER.md` and `docs/R1_LUNGMASK_VERIFICATION.md`.


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

## Streamed R231 memory increment — 2026-10-11 (feature branch)

Baseline main `ebe7ca2` has PR #16 merged and green Python/Web Actions. The user
supplied an actual previous-adapter Mac M1/8GB browser PASS on 32-of-103 public
slices; this does not accept full chest/Safari/system RAM. Later diagnostics
reported `modelReady=true`, HTTP 507, available 1318.625 MiB vs required 1496 MiB.

This increment removes native-volume float32 copies and float64 restoration
lists, avoids simultaneous weight copies, releases unused tensors and omits
eager SimpleITK/DICOM-reader imports. The six Apache-2.0 segmentation utilities
are retained unchanged; installed UNet source and official weights are SHA-bound.
Whole compact-volume postprocessing, float32/model resolution, source geometry,
mask binding and all existing research/privacy/voxel/concurrency boundaries stay.

Actual optimized R231→browser→three MPR planes→DELETE/404 passes on Linux with an
identical complete mask SHA. Same-host model peak is 828.05→701.77 MiB (15.25%);
Safe admission for 512×512×32 is 1219 MiB, model RSS ceiling 963 MiB. The 384 MiB
margin and 256 MiB runtime reserve remain. See `docs/R231_SAFE_MODE.md` and
`docs/verification/r231-low-memory-linux.json`. **Do not claim a new Mac memory
reduction** from Linux results: optimized M1/system/swap/Safari acceptance remains
pending. Do not simply reduce guards again to force a failed Mac to pass.


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

## Specialist Evidence increment — 2026-10-11

Baseline main `5690b59` includes manually merged PR #18 and green Python CI.
The user's next Mac report records checked commit `4528b24`, real R231 PASS,
730.64 MiB peak and no whole-system swap growth; see
`docs/verification/r231-tensor-lifetime-mac.json`. This is still a partial CT
reference and not repeated responsiveness/Safari/full-chest/clinical acceptance.

Source-bound specialist Evidence now derives metadata from the existing mask:
label counts/volumes, mask-grid bounds, an occupied LPS navigation point, model
and input/mask/weights SHA. R231 produces it automatically; a bound manual
passport import uses unrecorded execution mode. Local review/export/MPR navigation
do not sign a result or call LLMs. No volume copy, extra model execution, guard
change or patient/cloud activation. See `docs/SPECIALIST_EVIDENCE.md` for the
separate LLM contract and pending reconciliation/audit/sign-off boundaries.

## Local measurement reconciliation increment — 2026-10-12

Baseline main `0b84bc4` has PR #19 manually merged and green Web Actions.
Specialist Evidence now accepts explicit bound `opus-llm-measurements/v1` claims
and exports numeric differences/abstention as `opus-evidence-comparison/v1`.
Templates contain no prediction and unknown coverage. Imported source/provider/
coverage claims are unverified; equal numbers never imply clinical agreement.
Legacy orchestra findings cannot be converted by guessing anatomy or coverage.
No model rerun, extra volume copy, guard change, paid call or patient/cloud route.
See `docs/EVIDENCE_RECONCILIATION.md`. Spatial ROI reconciliation, independent
inference, durable physician audit/sign-off and R1 acceptance remain pending.
