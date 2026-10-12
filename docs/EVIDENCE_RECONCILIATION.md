# Local Evidence comparison — research increment

This is a metadata-only browser adapter, not another model or clinical critic.
After receiving a bound specialist mask, its Evidence card can download a blank
LLM-claim template, import a structured JSON file and export both results with
numeric differences or explicit abstention reasons. No API call, paid provider,
model execution or image/mask copy is added. Labels refer only to loaded slices.

## Implemented contract

`web/lib/evidence-reconciliation.ts` accepts `opus-llm-measurements/v1`:

```json
{
  "schema": "opus-llm-measurements/v1",
  "clinicalStatus": "unverified_research_draft",
  "producer": { "kind": "llm", "provider": "not-recorded", "model": "not-recorded" },
  "source": {
    "requestId": "copy-from-current-template",
    "sourceIdentitySha256": "64-lowercase-hex-characters-from-template",
    "inputSha256": "64-lowercase-hex-characters-from-template",
    "frameCount": 32,
    "modality": "CT"
  },
  "claims": [{
    "claimId": "claim-1",
    "observationId": "copy-current-target-observation-id",
    "modelWeightsSha256": "64-lowercase-hex-characters-from-template",
    "metric": "label-volume-ml",
    "scope": "unknown",
    "valueMl": null,
    "statement": "Measurement not provided.",
    "anchor": null
  }]
}
```

The example uses placeholders; download the template for actual binding fields.
Template values are null, coverage unknown and provider/model not recorded: it
does not create a prediction or prefill an LLM answer with the mask measurement.
Only populate a value and provider/model from a separately obtained result.
Set `scope: loaded-slices` only when the claim refers to **exactly this complete
loaded scalar input**, not selected JPEG frames or an assumed whole organ.
`full-organ` and `unknown` remain visible but cannot be numerically compared.
`metric: other` preserves an unsupported hypothesis without treating R231 as a
pathology detector. An arbitrary prose anatomy name never identifies a label.

Numeric comparison requires matching request ID, salted source identity, exact
input SHA, frame count, modality, existing observation ID, target weights SHA,
loaded-slice scope and a finite nonnegative volume in ml. A locally rejected
specialist label also prevents comparison. No missing label becomes a zero-organ
or negative pathology finding. Several failure reasons may be reported together.

The adapter computes `deltaMl = LLM value − mask value`, with no fabricated
clinical tolerance. Status is `numeric_difference`, `numeric_match` or
`not_comparable`; **all** rows are `needs_review`. Equal values do not establish
clinical agreement. Hashes bind the claim to an input/target declaration but do
not prove that a provider saw those pixels, reviewed all frames or independently
measured anything. Import/export provenance is always `imported-unverified`.

`opus-evidence-comparison/v1` exports the specialist snapshot (including current
local review), canonical LLM claims, both numeric values, differences and reasons.
The existing `opus-orchestra/v1`/`opus-evidence/v1` cannot be auto-converted: they
lack exact input hashes, explicit label targets and comparable loaded-volume
scope. Their separate local source-slice viewer continues to work. The comparison
import explains the missing fields instead of guessing or claiming agreement.

## Optional spatial point

The same claim can include an optional anchor; older imports with no anchor
continue to work. The template leaves it null and never copies a specialist
point into an alleged LLM observation. A provided anchor has this structure:

```json
{
  "coordinateSystem": "LPS-mm",
  "pointLpsMm": [10, 21, 27],
  "maskSha256": "64-lowercase-hex-characters-from-current-mask"
}
```

These example coordinates are arbitrary, not a real finding. RAS, pixels,
nonfinite values and malformed coordinates are rejected; no silent conversion.
Point QC matches the input/source binding, observation/weights, current mask SHA
and local review, then maps LPS through the inverse source affine and checks
the physical image extent (inclusive half-voxel boundary used by MPR). A wrong
binding, missing/rejected target or outside point disables navigation.

The active MPR runtime samples exactly one nearest-neighbour voxel from its
already bound mask. Exported spatial state records continuous source indices,
sampled label ID and `target_label`, `different_label`, `background` or
`not_checked`. An unavailable/closed sampler never becomes a background label.
Axis permutations/reversals use the mask's own inverse affine; no resampling or
volume scan/copy is added. Spatial QC is independent of quantitative coverage:
a point may be inspectable while a whole-organ volume/pathology claim remains
not comparable. Every spatial result still requires review.

The point button synchronises all three MPR planes and selects the sampled label;
background shows all labels. Both the supplied point and the specialist anchor
remain separately available. A label hit proves only a discrete mask lookup,
not a correct lesion, organ attribution, LLM observation or diagnosis. Background
does not exclude pathology. This is point QC, not full lesion/ROI registration.

## Lifecycle, resource and privacy boundary

Import is capped at 512,000 UTF-8 bytes and 100 unique claims. Types, finite values,
hashes, lengths and research status are validated. Unknown properties are dropped,
including tokens, raw buffers and arbitrary extra PHI fields. Allowed free text
may still contain sensitive data: allowlisting is **not** anonymisation or a
permission to upload these files to Gemini/Claude or another external service.
Patient/cloud/remote gates remain OFF; `.env.local` is untouched.

No volume-sized allocation/scan is added. The comparison uses O(claims + labels)
metadata. It does not change R231 inference, 8,388,608-voxel export cap, 48 MiB MPR
cap, worker concurrency or resource admission. Four execution modes remain the
architecture, with optional LLMs separate from specialist model provenance.

Latest-started imports win; malformed replacement retains the previous import
with an explicit error. Local specialist review immediately recomputes comparison.
Clearing hypotheses, mask deletion, successful mask replacement and MPR teardown
discard comparison state. State lives in page memory until explicit local JSON
download. Specialist changes/resets now append a local review journal included
in the comparison snapshot, with source-bound standalone export/restore; see
`EVIDENCE_REVIEW_HISTORY.md`. Authenticated persistent physician audit, signature
and clinical approval remain planned.
The combined card now exports readable local HTML with the current specialist
review, supplied hypotheses and fresh comparison/point QC; see `EVIDENCE_REPORT.md`.

## Validation and remaining work

185 Web unit/contract tests cover independent binding-field failures, scope/task/
target abstention, absent/zero/missing volumes, local rejection, exact numeric
comparison, templates, strict bounded parsing and metadata allowlisting, optional
LPS anchors, flipped/permuted grids, half-voxel boundaries and unavailable masks.
TypeScript/production build and the synthetic browser regression cover import,
numeric discrepancy, wrong-input abstention, legacy rejection with prior-state
retention, review-aware export/deletion, actual point-to-three-plane navigation,
different/target label lookup and wrong-source/mask/outside/rejected blocking.
Synthetic claims are not actual LLM
inference or real-model/clinical evidence; no medical model was rerun.

Authenticated provider output, independent measurements, spatial LLM ROI pairing,
clinical significance rules, longitudinal comparison, authenticated physician audit
and sign-off remain planned. Mac/Safari/full-native-chest/clinical accuracy
acceptance is unchanged from the separately recorded R231 reports.
