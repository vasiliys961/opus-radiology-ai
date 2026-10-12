# Local privacy review journal

Baseline main `28be9d8` includes manually merged PR #27 and green Web Actions.
This increment records the existing local copy/OCR/manual workflow; it does not
open patient cloud or run a medical model.

## Working behavior

Preparation starts `opus-privacy-journal/v1` with a random session ID and the
initial cleaned PNG SHA, modality and dimensions for each ephemeral frame ID.
Successful raster redaction appends the previous/new SHA and native rectangles.
OCR start revokes both review marks and text acknowledgement; completion records
only the region count. Cancellation/failure have fixed event kinds, no error text.
An explicit non-identifying-text acknowledgement and setting/removing either
human check are recorded separately. A refused check does not become a decision.
Image changes reset OCR/acknowledgement/review state while preserving prior events.

The UI shows history and offers three explicit local downloads:

- Existing `opus-vision-privacy/v1` candidate: unchanged shape, requires both
  checks on every exact copy and consistency with the recorded actions.
- `opus-privacy-journal-export/v1`: metadata-only journal and its canonical JSON
  SHA, available before all human checks if no OCR is running. No PNG/pixels.
- `opus-vision-privacy-review/v1`: candidate plus matching journal/digest;
  requires complete exact-copy human checks. This bundle contains sensitive pixels.

Replay validates sequential revisions, current frame hashes, rectangle bounds,
OCR state/terminal events and review prerequisites. Export compares replayed
redactions/reviews with the current copies and revalidates their actual PNG bytes,
SHA and dimensions. Changing a current copy or mark outside the history refuses
export. Known fields are projected explicitly; unknown fields are never serialized.
History contains no recognized words, source UID/filename, DICOM, patient/context/
reviewer text, token or arbitrary error text. Nothing is sent to a provider/server,
written to console or automatically persisted to browser storage.

## Limits and trust

At most 128 events per session, shared across at most four frames. Capacity is
reserved for the terminal event before OCR starts. At capacity, further actions
refuse with save/restart guidance; entries are never silently truncated. Starting
copies again creates a separate journal and clears checks; save the current file
first. Source/plan replacement or unmount clears the local session. There is no
import/restore endpoint, history merge, protected storage or authenticated audit.

Binding is to the initial sampled windowed copies, not an authenticated original
study identity. Equal pixels can share hashes; a hash is not de-identification or
clinical source verification. Clock, actor and declarations are unverified and
unsigned. SHA supports technical comparison, not tamper-proof provenance: a file
editor can rewrite history and recalculate it. Metadata-only files can still be
sensitive through timing/hashes. Bundle export duplicates no study volume but
JSON/base64 increases the bounded copy export's temporary memory footprint.

Candidate flags remain `transmissionPermitted:false`,
`deidentificationVerified:false`, sampled-only/local-review-draft. No local journal
is a trusted server attestation. Independent tag/pixel/recognizable-feature privacy
acceptance, clinician/study authorization, lawful provider context and protected
server audit/retention remain required. `/api/ai` still returns 410. Four execution
modes, specialist/optional Gemini/Claude Evidence separation, .env.local and all
R231/Safe/voxel/MPR guards remain unchanged. No new Mac memory, Safari/full CT or
clinical accuracy acceptance is claimed.

## Verification

From `web/`: `npm test`, `npm run typecheck`, `npm run build`,
`npm run test:browser`. New unit tests cover immutable history, stale/hash mismatch,
actual raster mismatch, replay/allowlisting, OCR prerequisites and cancellation,
reserved capacity and fresh sessions. Synthetic browser tests exercise candidate/
bundle/journal downloads, unchanged source, review reset, history revisions/SHA,
restart and actual local OCR on synthetic English/Russian text. Existing mask SHA,
binding, MPR and resource regressions remain; no trained medical model rerun.
