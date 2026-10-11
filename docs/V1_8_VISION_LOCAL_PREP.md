# v1.8 — Local Vision frame planning and completion sound

Branch: `feature/v1.8-frame-plan-audio`.

## What is working

- For an active, physically sorted and validated CT/MR DICOM series, the browser can
  create a deterministic **local-only** candidate set of up to four separate frames.
- Uniformly sampled source frames preserve their **SeriesInstanceUID, SOPInstanceUID,
  frame index, local file identity and physical position projected on the DICOM slice normal**.
- Inconsistent StudyInstanceUID, SeriesInstanceUID, FrameOfReferenceUID, repeated SOPs,
  malformed UIDs, multiframe objects, missing geometry and unverified volume geometry
  block the plan. It never silently substitutes another series when the user selected one.
- The UI provides click-through navigation to each source DICOM slice and attempts
  bounded serial thumbnail generation for **small, uncompressed, grayscale** frames
  using the existing local DICOM preview decoder.
- When preview decoding fails (unsupported compression, file larger than 6 MiB, etc.)
  the source link stays available, but the thumbnail is explicitly marked unavailable.
  Cornerstone's existing DICOM viewer may still render those files.
- **Nothing is uploaded.** The plan has `transmissionPermitted: false`,
  `deidentificationVerified: false` and `coverage: sampled-frames-only`.
  No LLM analyzes any patient image in this milestone.

## Sound — the requested «дзинь»

The physician may explicitly enable a two-note completion chime in the existing AI panel.

- Off by default and persisted in the browser's localStorage.
- The **«Проверить звук · дзинь»** button plays a test tone on direct user click.
- After successfully preparing a local frame manifest, the workstation plays the
  same tone *only when the opt-in is enabled*. Failure and cancellation remain silent.
- Uses the Web Audio API with a low volume envelope (sine wave at two pitches),
  no audio downloads, server requests, microphone permissions or medical data.
- Browsers, including Safari, may require direct interaction before playback;
  macOS speaker output and hardware volume remain OS-controlled.
- The context is shared within the workstation so future **genuine analysis
  completion handlers** can reuse `completionChime()` only after the final
  validated result is ready. **There is no real AI inference completion yet.**

A separate macOS GitHub watcher was developed under PR #7; it is not part
of this in-app notification feature. The GitHub watcher rings after a completed
and merged development stage; the in-app sound rings after a successful
local operation, and later after real inference when authorized.

## Clinical limitations

Four uniformly selected frames can miss lesions. The manifest **does not**
certify whole-exam coverage, correctness of sequences, detection, anatomical
segmentation, quantitative measurements or a diagnosis. It cannot replace full
image interpretation. Pixel thumbnails may contain burned-in patient information,
and are displayed **locally only**, never exported to an AI aggregator.
The de-identification, consent, clinician authorization and audit work from the
v1.7 privacy milestone must be validated before any real cloud transmission.

## Tests

- `web/lib/vision-frame-plan.test.ts`: physical sample indices, exact SOP identity,
  geometry, multi-frame and wrong-study rejection, no cloud permission.
- `scripts/check-segmentation-browser.mjs`: generates synthetic DICOM, verifies
  offline thumbnails, navigates to exact slices, exercises opt-in/speaker test
  using a deterministic fake WebAudio implementation and confirms opt-out is silent.
- GitHub Actions: `npm test`, `npm run typecheck`, `npm run build`,
  `npm run test:browser`.

## Next

1. Complete independent DICOM tag/pixel privacy assessment and a real physician
   authentication/consent flow before sending any patient pixels.
2. Choose validated provider-specific Vision model IDs and test actual aggregator
   compatibility on generated **non-patient** images only.
3. Add clinically reviewed sampling algorithms and full-volume contextualization,
   with detection of uncertain coverage.
4. Connect result validation and physician review; notify on **verified pipeline
   completion**, rather than HTTP completion or partial streaming output.
