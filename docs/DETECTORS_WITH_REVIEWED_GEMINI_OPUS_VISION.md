# Original DICOM detectors + reviewed PNGs → Gemini Vision → Opus

The previously merged numeric-only Gemini/Opus research consilium remains a
separate secure option. This module connects **actual already executed** DICOM
pathology model outputs to the already implemented real deidentified-image
Vision pilot. No new pathology detector, no duplicate model forward, and no
replacement privacy infrastructure.

Flow:
1. In DICOM Viewer select one authentic public/rights-cleared CT/MR series.
   The one-click native detector runs and produces a source-verified result.
2. The browser builds only fixed numerical completed/not-assessed task facts.
   It never sends original CT NIfTI SHA, DICOM study/series/SOP UID, filenames,
   patient age, coordinates, model weights or DICOM itself.
3. Open "Подготовить кадры для Gemini + Opus" **on the same selected series**.
   Existing local PNG pixel cleanup, OCR, annotations/redactions and two
   reviews per exact PNG remain mandatory before the image pilot is enabled.
4. An additional **off-by-default physician checkbox** allows sharing only
   those numeric pathology facts with the **same** reviewed images, after
   all existing clinician/provider/paid-call approvals and local operator token.
5. Gemini Vision reviews the selected actual approved image pixels first.
   Its source-frame-validated JSON observations and the same numerical model
   facts are then sent to **Claude Opus Vision** for a second, independent
   critical look. There are exactly two paid calls (no additional reruns).
6. Browser source IDs remain local. Both models' source-frame observations
   are linked to original DICOM only in the local viewer, with physician
   options to reject/flag findings. No negative diagnosis and no claim of
   independent clinical validation.

One DICOM source series is checked at the browser level for detector-output
identity. The optional detector numeric bundle is removed whenever the user
changes/clears the DICOM study, restarts detector inference, changes the
reviewed original PNG or toggles numeric sharing.

Use the existing operator-gated, local development-only paid Vision pilot
settings documented for \`/api/ai/deidentified-openrouter-review\`. No public
production endpoint or automated patient cloud transfer was enabled.
Provider model availability/terms still require real configuration.
The old local numeric consilium uses a separate key and paid-cost toggle;
the two options do not automatically run both to avoid duplicate API calls.

Important: models see **at most four sampled PNG frames**, not the full CT/MRI
volume. This workflow is not complete volume vision coverage. Independent
deidentification and clinical validation are not claimed.
