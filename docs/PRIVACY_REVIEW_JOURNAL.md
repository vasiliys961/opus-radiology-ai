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
server import/restore endpoint, protected storage or authenticated audit. Explicit
local bundle restoration is described below.

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


## Explicit local restoration — 2026-10-12

Baseline main `42ea468` includes manually merged PR #28 and green Web Actions.
After loading the same selected CT/MR previews, choose **Восстановить копии с
журналом JSON**. Only full reviewed copy+journal bundles v1/v2 are accepted;
a candidate or metadata-only journal does not contain enough bound information.
There is no server upload or automatic local storage. The file selector is
cleared immediately and errors never include imported JSON fragments.

The browser checks a 12 MiB file limit before reading. The pure parser also bounds
its input to 12 MiB characters; direct callers must provide bounded text. Existing
four-frame/2 MiB PNG/1,048,576 pixel/32 rectangle/128 event limits still apply.
Candidate privacy flags, wrapper/journal versions, exact PNG bytes/CRC/SHA/grid,
canonical journal SHA, replayed states and initial cleaned-copy bindings must
match. Initial source matching uses current preview PNG hashes/modality/dimensions/
order, not an imported UID or filename. Wrong selected frames or window refuse.

An empty current journal may adopt a saved matching session. A nonempty journal
accepts only the same session/creation time with its entire current prefix intact;
older, forked or different-session files cannot overwrite it. No history merge or
truncation is attempted. Validation/decoder failure or cancellation leaves current
copies, history and checks intact. The original DICOM/MPR/mask/Evidence never change.

After structural checks, imported PNGs decode sequentially, each with a 5-second
limit and cancellation/unmount cleanup before committing the entire result.
A same-tab compute slot serializes restoration with OCR/R231 until cleanup;
this is not a cross-tab or OS RAM guarantee. Import parses bounded JSON/copy
strings, not a study volume; this is not a measured Mac memory improvement.

Successful restore preserves hidden raster pixels and prior history, then appends
one `copy-restored` event per frame. Both human checks and transient OCR results/
text acknowledgement are cleared: inspect the displayed copies again, optionally
repeat OCR, then make fresh manual checks before candidate/bundle export.
The parser requires room for restore entries and both new checks per frame.
No imported mark is current acceptance or a cloud release.

Restored histories and their journal/bundle export wrappers use **v2** so old
clients refuse unknown reset semantics. Native v1 sessions and candidates retain
their format. Both full bundle versions can be restored by the new client.
SHA/digest checks detect accidental mismatch; an attacker can rewrite the whole
unsigned bundle and recalculate them. Matching sampled pixels is not authenticated
study provenance or independent de-identification. Patient cloud remains OFF.

247 Web tests plus synthetic Chromium verify v1/v2 save/restore, actual black
pixels and unchanged source, required re-review, exact history preservation,
older/forked/wrong-source/corrupt/oversized refusal, version/flag/digest checks,
error sanitization and decoder cancellation/cleanup. No real patient or trained
medical model rerun, provider request, M1/Safari/full CT or clinical acceptance.
