# Local preparation readiness — 2026-10-12

Baseline main `4473328` includes manually merged PR #30 and green Web Actions.
This increment makes current privacy preparation visible, without cloud egress.

## Working UI

The privacy workbench shows each prepared sampled frame, its optional SHA-bound
OCR status (not run, stale, zero detections, positive detections), explicit text
acknowledgement, both human review marks and redaction count. Zero OCR detections
never complete human review or certify de-identification. Marks apply only to the
current PNG SHA; redaction/restore/reset revokes the relevant local state.
At most four rows are rendered. Busy OCR/import/redaction blocks the aggregate
local-ready status. OCR remains assistance, not a mandatory privacy verifier.

A separate section lists the seven still-unconnected server requirements from
the shared patient-cloud policy: clinician/study authorization, DICOM/pixel
privacy, provider context, protected audit/retention and validation of the review
workflow. Local review completion never marks those server controls as verified.

The new explicit **Скачать локальный статус без пикселей JSON** action creates
`opus-local-privacy-readiness/v1`. It is also available for incomplete drafts.
Before export, existing bounded PNG/CRC/SHA/dimensions and journal replay/state
checks run; mismatches fail. The file contains only projected technical frame
metadata, OCR counts/status, local marks, server-block reasons and current journal
SHA/revision. No PNG bytes, OCR words/confidence, original IDs/filenames, DICOM,
clinical/reviewer text, tokens, opaque fields or raw journal are serialized.
Files with hashes/metadata can still be sensitive; keep them local.

## Memory and trust

Rendering reads metadata only: no image decoding, pixel copying, PNG hashing,
canvas, model allocation or network. Exact PNG/journal verification happens on
explicit export using the existing sequential bounds. Export paths avoid redundant
journal validation for bundle/status exports. Existing four-frame/2 MiB PNG/1M
pixel/32 rectangle/128 journal/voxel/MPR/Safe/concurrency guards remain unchanged.
No new Mac memory improvement or responsiveness benchmark is claimed.

The status is an unsigned local snapshot, not authenticated source provenance,
independent privacy acceptance, clinical approval or a trusted server attestation.
The exported fields remain sampled-only, deidentificationVerified:false and
transmissionPermitted:false, even after every human mark. No status import or
send endpoint is added. `/api/ai` stays 410; main patient hybrid analysis remains
blocked. Four modes, specialized models/optional Gemini-Claude-GPT through
Evidence and all R1/Safari/full CT/clinical boundaries remain unchanged.

## Verification

257 Web tests cover exact-copy marks, optional/zero/positive/stale OCR, busy state,
metadata-only rendering without reading PNG/opaque getters, checked export and
current-raster/journal mismatch, restore/reset and always-false cloud flags.
Typecheck/build and synthetic Chromium check 0/4→4/4→reset/restored 0/4, metadata
export/current journal digest, unchanged source and zero OCR still unreviewed.
Existing mask SHA/binding/MPR/Evidence/privacy/OCR/restore/model-selection checks
remain. No new paid provider call, medical model rerun or patient transfer.

Run from `web`: `npm test`, `npm run typecheck`, `npm run build`,
`npm run test:browser`. Actual paid synthetic gateway tests require the user's
local configured server key and explicit acknowledgement; keys are not available
in this development environment and no live completion was run for this change.
