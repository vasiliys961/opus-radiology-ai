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

PRs #6–#11 already merged into \`main\`. DICOM/Cornerstone/MPR/3D, Study Intelligence, NIfTI package/mask import, experimental ONNX CPU runner **tested with a synthetic identity checkpoint** and OpenRouter calls **on nonpatient generated PNGs** exist. No trained medical checkpoint or one-click local worker is installed by these PRs. No clinically validated universal pathology detector exists.

Next **R1**: run **real Lungmask R231** on licensed public CT chest on M1 via isolated \`127.0.0.1\` worker, browser button, display exact MPR mask and benchmark timing/memory; no PHI egress. The current custom ONNX runner cannot simply load pretrained \`.pt\` Lungmask weights—write a proper specialist adapter.

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
