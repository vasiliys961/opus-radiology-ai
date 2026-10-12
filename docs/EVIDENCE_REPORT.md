# Local printable Evidence report

The specialist Evidence card can download a readable, self-contained HTML report.
The LLM comparison card can download the combined report using the current
specialist review, imported claims and a fresh active-mask point lookup. Open the
file locally and use the browser print menu to print or save PDF. This is a
research draft, not a generated diagnosis, authenticated clinical opinion or
signed report. A doctor must still inspect the source and decide independently.

## Implemented contents

`web/lib/evidence-report.ts` renders separate sections:

- Source/model provenance: request, modality, loaded frame count, declared task,
  execution mode, input/source/mask/weights SHA and both LPS grids/affines.
- Native mask measurements: label IDs/names, voxel counts, label volume in loaded
  slices, occupied navigation points and current local review status.
- Imported LLM hypotheses: declared provider/model and input binding, supplied
  claims, metric/scope, both values, signed difference or explicit abstention.
- Spatial QC: supplied LPS point/mask SHA, continuous source index, actual discrete
  mask label, target/different/background/unavailable state and binding failures.
- Local history: revision, observation, previous/new status and declared UTC time.
- Separate saved general/label reviewer drafts with each target's latest text,
  exact observation and occupied-label LPS anchor, stale/cleared/missing state; clinician
  authentication, clinical approval and signature remain absent.
- Coverage/provenance/privacy limitations.

No LLM import is stated as no imported evidence, not a negative finding. An empty
mask is not a normal scan. Missing values remain missing; zero remains zero.
Unsupported claims, wrong sources, outside points and rejected labels stay visible.
Equal numbers or a label hit never become clinical agreement; no diagnostic
confidence or clinical significance threshold is invented. Displayed volumes/
differences use six significant digits, explicitly labelled as readability
formatting. Comparison uses raw values; small differences remain nonzero and
never become agreement through rounding. Exact values remain in JSON exports.
Volumes never imply complete organ coverage.

History is replay-validated and must agree with the current review states before
report creation. Invalid binding, continuity, promoted status or inconsistent
history refuses export with a visible error. Measurements are not reimported from
reports. General report import and clinical sign-off remain planned. Separate
reviewer draft editing/versioned restore is now available; see `REVIEWER_NOTE.md`.
The JSON Evidence, comparison and standalone journal exports
remain available for structured local workflows.

## Local execution, safety and resources

The report is generated only on button click from already validated metadata.
Object-side allowlisting shares existing LLM/journal validators without serializing
unknown buffers, tokens or raw images. Unknown fields are ignored; HTML text is
escaped. User/imported text never becomes markup, scripts, links, forms or images.
The file has a restrictive Content Security Policy (`default-src 'none'`), no
referrer, fixed inline print CSS and no external resources or JavaScript. The
draft marker remains in printed output. Printing is an explicit browser action;
the app does not auto-open a popup or contact a PDF/provider service.

Output is capped at 2 MiB; existing metadata and journal limits still apply.
Generation never scans/copies a DICOM volume or mask, and retains no report state
beyond the explicit Blob download. Temporary URLs are revoked. The only mask
access is existing single-voxel point QC. No model rerun, new provider dependency,
paid API or worker job is added. Four execution modes and all MPR/voxel/resource
guards remain unchanged.

Escaping/allowlisting is not anonymisation: allowed labels/model/claim text, hashes
and coordinates can be sensitive. Keep reports local; patient/cloud/remote gates
remain closed and `.env.local` is untouched. A saved report is a snapshot, not a
live link to future review changes. It has no signature, trusted clock, protected
clinical audit or retention/access-control guarantee.

## Validation boundary

From `web/`:

```bash
npm test
npm run typecheck
npm run build
npm run test:browser
```

213 Web unit/contract tests cover source/review/claim separation, empty/missing/
zero values, numeric/spatial abstention, rejection, history consistency, time/status
validation, HTML escaping/CSP, output limits and never reading unknown opaque
payloads, backward-compatible general notes and independent exact label targets.
The synthetic browser regression downloads both variants, checks current
rejected history, opens the combined report as inert text with no requests and
prints it to PDF using Chromium. Synthetic PNG/PDF previews may be CI artifacts;
patient/reference pixels and real clinical reports are never CI inputs/artifacts.

This is not real Gemini/Claude inference, R231 clinical validation, Safari print
acceptance, M1 memory/response measurement or full-native-chest acceptance. Those
boundaries and authenticated clinical report workflows remain pending.
