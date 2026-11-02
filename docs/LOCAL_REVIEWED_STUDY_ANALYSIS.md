# Local reviewed-study analysis

## Sequential reviewed series — 02.11.2026

Ordinary `/viewer` → Analyze now opens `ReviewedSeriesAnalysis` for the complete
**selected CT/MR series**, not a four-frame study sample. Existing source-verified
planning, receipt accounting and final Opus synthesis are reused. A 267-frame
series plans 67 groups (66×4 + 3); groups are decoded serially, including the
installed Cornerstone fallback for compressed scalar DICOM. No full-volume
pixel array is allocated. Compressed metadata-free PNG copies are held only in
this tab, bounded at 96 MiB of estimated UTF-16 base64 storage; only one group is
decoded/OCR-processed or rendered at once. No disk/IndexedDB persistence.
Exceeding the bound stops before transmission; this is not full large-study
Mac memory acceptance.

The doctor approves the Gemini call count/budget and one final paid Opus request,
then the complete series is prepared and OCR-checked locally before any image
POST. The doctor can scrub all prepared copies and resolve suspicious groups
using the existing source-bound redaction/review editor. One explicit whole-series
attestation permits automatic sequential submission; clean groups require no
separate release. Unresolved OCR exceptions block this attestation. OCR absence
never sets human-review hashes; hashes are marked only on the doctor's explicit
whole-series confirmation. OCR does not perform facial de-identification.
Original DICOM, UID, filenames and free-text metadata remain local.

Each Gemini request has validated bounded contiguous slice ordinals and total
series frame count plus validated numeric spacing, allowlisted anatomy, standard
MR sequence codes and declared/unknown contrast. Mixed/missing values remain
unknown; phase and MR weighting are never inferred from these codes. The prompt asks for quality/morphology/uncertainty and continuity
across neighboring slices, without inventing phases, sequences or measurements.
Actual provider receipts advance the N/M coverage counter. Provider/decode/budget
failures do not skip a group or silently repeat a paid request. Partial observations
can be downloaded as TXT and navigated on their original source slices. Only a
complete overview enables final text-only Opus; absent/timed-out detectors remain
explicitly unassessed and do not disable the independent Gemini path.

Limitations: one selected series, one display window per frame; no automatic
multi-sequence or multi-window coverage, dynamic lesion second pass, blind visual
Opus reread, independent diagnostic validation, or actual 267-frame paid acceptance.
The current final synthesis still has its 180-observation/110k-character guard;
overflow preserves partial observations rather than discarding findings. The
Gemini threshold is configurable; the displayed cost is calculated from returned
tokens at configured rates, not an account-level billing guarantee. Failed calls
may have incurred provider charges even when no usage receipt was returned.

The reviewed signed session is now scoped to `/api/ai` and accepted only by the
existing reviewed sample, explicitly marked reviewed-batch and final synthesis
handlers. Local host/origin, saved administrative/provider approval, exact packet
privacy checks and per-call authorization remain. The public auto-OCR flag stays
off; this cookie does not authorize that separate automatic mode. Reviewed batches
have a separate one-active-request, 128-call/hour process limiter (enough for one
267-frame overview); the old public limiter is unchanged. No production/patient
cloud release or aggregate distributed budget is implied.

Verification:
- `check-reviewed-series-browser.mjs`: native synthetic DICOM → local PNG/OCR →
  one whole-series release → automatic 4+4+1 → three mocked Gemini calls → one mocked final Opus. Exact coverage
  and slice anchors verified, no paid calls or diagnostic accuracy claim.
- The same test with `OPUS_TEST_PARTIAL=1`: 4/9, 5 unassessed, no final Opus, partial TXT.
- `check-reviewed-volume-session-dev.mjs`: actual local Next handlers reject missing
  sessions/cross-origin requests; valid signed sessions reach content-type validation
  with invalid nonimage payloads; public automatic mode remains disabled. No model calls.
- `reviewed-volume-context.test.ts`: all 267 indices occur exactly once in 67 groups,
  final group contains three frames; malformed/free-text contexts rejected.

## Reviewed image preparation

The ordinary reviewed workflow now uses OCR to **mark** possible text without
automatically painting over diagnostic anatomy. On a real public CT the former
automatic redaction removed tissue after OCR false positives. The physician can
select a marked region, redact an actual identifier and rescan, or explicitly
retain a visually verified false positive. SHA-bound reviews and disclosure
approval remain required; unresolved OCR cannot be silently bypassed. The
separate explicitly approved automatic public-volume research mode is unchanged.

A source-linked CT/MR reconstruction tagged `DERIVED` may enter this reviewed
visual path if its identities and geometry pass. Its native quantitative model
eligibility stays blocked; the tag is not rewritten. The viewer displays the
restriction instead of silently hiding the primary analysis action.

An explicitly provisioned development workstation may avoid manual operator
password entry for this exact route. Keep the existing provider key in
`web/.env.local`; do not copy or rewrite it. An administrator may put only these
settings in the Git-ignored `web/.env.development.local` after verifying the
processing arrangements:

```dotenv
RADIOLOGY_ENABLE_DEIDENTIFIED_OPENROUTER_PILOT=1
RADIOLOGY_OPENROUTER_HEALTH_DATA_APPROVED=1
RADIOLOGY_LOCAL_REVIEWED_FRAME_SESSION=1
```

After starting `npm run dev`, the primary **Анализировать исследование** action
automatically connects the preapproved workstation while preparing frames.
Opening DICOM files alone never establishes this connection. A failed check
offers **Повторить проверку подключения** without rerunning a detector or
initiating paid inference. Standalone technical panels retain manual connection.
Connection issues a four-hour HttpOnly, SameSite=Strict cookie scoped to
`/api/ai`. It authorizes neither automatic unreviewed public-volume upload
nor any new image. Every submission still passes the
existing exact-copy packet validation, acknowledgement and provider gates.
Per-group exception edits retain the existing local review journal; whole-series
release is an explicit local physician attestation, not an authenticated signature.
No image or paid inference is sent by connecting. The legacy manual operator
password path remains available; late detector reconciliation still uses it.

Actual local browser acceptance on 2026-11-02: the pinned public TCIA source
opened, four visually checked unchanged PNG copies reached real Gemini/Opus,
and an 1885-character preliminary report appeared with a successful TXT download
in 47.894 seconds. Only four frames of a declared 32-of-103-slice slab were
reviewed in the source soft-tissue window. No specialist model forward or
diagnostic accuracy is claimed. See
[the technical record](verification/reviewed-public-ct-mac-live.json).

The public automatic volume research path remains in `/viewer?research=1` with
its own existing server permission. Missing/failed authentic local detectors
remain not assessed; a cloud report does not manufacture detector results.
