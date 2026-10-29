# Real original-model evidence → Gemini → Claude Opus (numeric stage)

This module composes already executed original pathology detectors from the SAME
selected original source study into one deduplicated report. It does **not**
install any new detector or re-run an identical disease task.

In the DICOM Viewer under the unified CT/MRI launch, finish actual model
inference first. The new **Gemini → Opus** section appears on success.
It reports each specialty task as completed with model candidate count and
optional unvalidated candidate-mask volume, OR **not assessed** when no actual
model ran. A reported zero is not negative disease evidence. It rejects mixing
two different chest/abdomen original NIfTI SHA-256 values locally; all source
SHAs and patient identifiers stay in the browser and are NOT sent to cloud.

Physician must explicitly confirm authorized sharing of the following data
and approve two paid calls via chosen OpenRouter or Polza provider:

- Fixed task IDs (no free-text diagnosis/prompt fields);
- CT/MR, anatomical region;
- Limited finite model candidate counts and aggregate volumes;
- Explicitly missing/not-assessed status, research-validation limitation.

There is NO DICOM pixel upload, source UID, frame index, original file name,
model checkpoint hash, source SHA, age, patient narrative or medical identifier
in the external request. Gemini receives numeric evidence **as text**, then
Opus receives the same numeric evidence and Gemini's structured critique.
**This is not Gemini Vision.** Original-frame vision, automated deidentification
verification and source-linked frame visual review remain an independent
separately gated feature. Gemini cannot validate a pathology detector;
Opus remains a provisional unsigned note editable by a physician.

## Local development configuration

Remote providers are OFF by default, even when the user opened the viewer.
Set all required server-side env vars (never embed secrets in GitHub or client):

\`\`\`text
RADIOLOGY_ENABLE_DETECTOR_CONSILIUM=1
OPENROUTER_API_KEY=<private-secret>
RADIOLOGY_GEMINI_NUMERIC_MODEL=<valid-google-model-ID-in-selected-provider>
RADIOLOGY_OPUS_NUMERIC_MODEL=<valid-anthropic-model-ID-in-selected-provider>
\`\`\`

Or use POLZA_API_KEY when choosing Polza (both model IDs must be available
through that provider). Model identifiers are deliberately operator-controlled
rather than inventing a supposedly current vendor model name. The endpoint
accepts only same-origin loopback requests in development mode to prevent
unauthenticated public cost exposure. It has bounded JSON, strict enumerated
facts and two starts per 10 minutes max. It cannot be deployed publicly without
an appropriate authenticated physician login, cost policy and security review.

The result is visible immediately, editable, and downloadable as a LOCAL
unsigned JSON. No browser storage, provider API keys, original DICOM frames,
or patient DICOM identifiers are included in that export.

Validated by TypeScript pure-contract tests of source separation, missing
tasks, bounded numerical facts, Gemini task whitelist and TWO sequential
actual provider-gateway calls (injected mock for CI; no paid calls in CI).

Functional limitation: caller-origin exact NIfTI SHA evidence does not yet
prove original DICOM SOP pixel-level coordinate registration. Clinical
validation is deferred but cannot be replaced by Gemini/Opus agreement.
