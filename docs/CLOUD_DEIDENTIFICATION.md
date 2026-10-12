# Cloud preparation — local pixel-only candidates

User goal: optional cloud analysis only after de-identification. This increment
implements actual local preparation, not an unrestricted upload gateway.
Baseline main `335d6d3` includes manually merged PR #25 and green Web Actions.

## Implemented

1. In the local Vision frame plan, wait for the chosen CT/MR previews and click
   **Подготовить копии без метаданных**. Raster copies are generated from decoded
   DICOM pixels, not viewer screenshots or original DICOM files.
2. Inspect each exact prepared copy at native 1:1 scale, scrolling all edges
   when needed so small text is not hidden by thumbnail downsampling.
   Enter a rectangle's X/Y/width/height in
   native pixels and click **Скрыть область в копии** to remove identifying text.
   It writes opaque black pixels into the PNG itself; an overlay, shutter or CSS
   patch is not used. Original pixels, MPR geometry, mask and Evidence stay intact.
3. Review the exact copy for identifying text and recognizable visual features.
   Both local checks bind to its SHA. Any redaction resets both checks. Selecting
   another copy preserves each copy's state. Starting again resets all checks.
4. After both checks on every copy, download the local candidate JSON.
   A separate local action journal and reviewed copy+journal bundle are also
   available; see [PRIVACY_REVIEW_JOURNAL.md](PRIVACY_REVIEW_JOURNAL.md). No fetch,
   upload, provider call, automatic persistence or clinical analysis occurs.
   Treat the file as sensitive: manual review is not proof of anonymity.

PNG preparation verifies bounded chunk lengths, CRCs, raster dimensions, supported
encoding and final termination. Only IHDR/IDAT/IEND survive; text, EXIF, ICC and
all other ancillary blocks are removed. Unsupported critical chunks refuse
preparation. Raster bytes remain identical when only metadata is stripped.
Copies are inspected after stripping so review applies to their actual display.

`opus-vision-privacy/v1` contains a fresh random packet ID, ephemeral frame IDs,
allowlisted modality/dimensions, PNG bytes and SHA, declared redaction rectangles
and exact-copy local review hashes. No original filenames, DICOM/private tags,
source/SOP/series IDs, source hashes, absolute coordinates, clinical context or
reviewer notes are included. Original references stay in the existing local frame
plan; this candidate is separate from specialist Evidence and cannot replace it.

The packet explicitly retains `local-review-draft`, `sampled-frames-only`,
`deidentificationVerified:false` and `transmissionPermitted:false`. Neither a
client checkbox nor an imported/forged JSON flag authorizes cloud processing.
There is no candidate import or automatic conversion to bound LLM observations.

## Resource boundary

- At most 4 sampled frames. This is not full-study coverage.
- Source preview file at most 6 MiB; uncompressed single-frame monochrome LE
  DICOM only, using the existing limited decoder. Compressed/enhanced/color
  sources refuse preparation; Cornerstone viewing remains separate.
- At most 1,048,576 pixels per copy, enforced before RGBA/canvas allocation.
- At most 2 MiB per PNG and 32 rectangles per copy. Base64 increases file size.
- Preview decoding and redaction are sequential; temporary redaction canvases are
  explicitly released. Candidate PNG strings are bounded and cleared on source/
  plan replacement or unmount. No full volume/model allocation or new dependency.

Copies use windowed 8-bit display values. They are not HU/MR intensity data for
quantitative measurements, do not retain source geometry, and hidden regions lose
diagnostic content. Stripping color profiles is not a claim of calibrated display.
No new Mac memory reduction, Safari/full CT or clinical acceptance is claimed.
Existing 8,388,608 voxel / 48 MiB MPR / Safe Mode guards remain unchanged.

## Still required before patient cloud can open

Local PNG metadata removal and optional local RU/EN OCR text localization are
working; see [LOCAL_PRIVACY_OCR.md](LOCAL_PRIVACY_OCR.md). OCR assists rectangle
selection/batch raster redaction and never certifies anonymity or checks a face.
Recognizable-feature removal/defacing, independent de-identification verification
and dataset acceptance are not implemented. Human declarations remain local and
unauthenticated.

An approved provider/processing context, clinician authorization, per-study legal
authority, trusted server-side checks and audit/retention controls are also absent.
The future restricted endpoint must revalidate bounded raster content and trusted
attestations server-side, map results through local source binding, enforce costs
and permit cancellation. It must not trust this candidate's client flags or reopen
the retired arbitrary `/api/ai` gateway, which still returns HTTP 410.

Specialist models remain separate from optional Gemini/Claude through Evidence;
four modes remain the architecture. `.env.local` is untouched. Raw patient egress
does not become available through the presence of an API key or model selection.
This is not a DICOM file de-identifier or a PS3.15 conformance claim.

Primary references:

- [DICOM PS3.15, Annex E](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_E.html):
  attribute de-identification alone does not guarantee object de-identification;
  preambles, file metadata, nested/private attributes and context matter.
- [DICOM PS3.15, E.3.1](https://dicom.nema.org/medical/dicom/current/output/chtml/part15/sect_E.3.html):
  Clean Pixel Data requires removal from stored pixel values, not an overlay.

## Verification

From `web/`: `npm test`, `npm run typecheck`, `npm run build`,
`npm run test:browser`.

247 Web unit/contract tests cover metadata stripping with unchanged raster bytes,
CRC/shape/critical-chunk/byte/pixel guards, strict base64 at the maximum size,
rectangle bounds, exact-copy review hashes, field allowlisting, source-free IDs
and refusal to promote local checks to cloud authorization. Synthetic browser
tests plant fake private/preamble/context identifiers, check actual black pixels
and unchanged originals, re-review/reset, all-frame export requirements, matching
SHA and metadata-free packet, no requests and refusal of forged release flags.
Existing SHA/binding/MPR/resource/privacy regressions remain. No real patients,
trained medical models, paid provider reruns or actual cloud acceptance tests.

Current per-copy local preparation status and checked metadata-only export:
[LOCAL_PRIVACY_READINESS.md](LOCAL_PRIVACY_READINESS.md). Local review completion
does not verify any server release requirement.
