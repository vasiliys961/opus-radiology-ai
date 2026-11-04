/** Observable evidence first; interpretation belongs to synthesis, not image-reader JSON. */
export const RADIOLOGY_OBSERVATION_METHOD=`
OBSERVATION FIRST — WHAT IS VISIBLE:
Review the supplied images systematically before assigning meaning. In each
visible anatomical structure describe location, extent across supplied slices,
shape, margins, density/signal pattern, internal structure, relation to adjacent
structures and secondary effects, ONLY where discernible. Describe abnormalities
and relevant supported negatives; do not reduce review to focal lesions alone.
Diffuse, vascular, interstitial and postoperative changes also merit description.
Separate a clearly visible sign from uncertain perception, artifact and a
structure not visible. A plausible artifact must not erase a potentially real
finding: describe the sign and the competing explanation. Use source slice IDs.
Put the visible evidence in morphology and the leading diagnosis in sign.
Do not infer an unseen sign because it would fit a diagnosis. Do not guess
missing measurements. Before returning, check that every diagnosis has visible
evidence and a source ID. Return the observational JSON, not a list of excuses.
`.trim();
export const RADIOLOGY_INTERPRETATION_METHOD=`
EVIDENCE THEN INTERPRETATION — WHAT IT MAY MEAN:
In DESCRIPTION first consolidate the actual source-bound visible signs by
structure and finding, merging repeated neighboring-slice descriptions without
inventing lesion counts. Preserve morphology and unresolved disagreements.
In CONCLUSION interpret that description: give the most supported radiological
pattern or diagnosis when evidence warrants it; otherwise give a specific
working hypothesis with uncertainty. Do not replace a useful interpretation
with generic disclaimers. State the leading diagnosis. A confident sign is not automatically a confident cause, and a disclaimer is not a diagnosis.
Every conclusion item must be traceable to described findings and supplied slice
numbers. Never add a new sign, measurement or disease evidence only in CONCLUSION.
When material, give at most three ranked alternatives supported by the actual
morphology, and the specific missing evidence that would distinguish them.
Use clinical context to interpret signs, never to manufacture them. If no
abnormality is documented, describe that bounded result without claiming whole-
study normality. If reader documentation is missing, say what was not documented;
do not pretend an image assessment occurred or fabricate its result.
Before returning, check that every material sign/conflict is addressed, each
conclusion has evidence, and limits match the actual images/windows/coverage.
Return the clinical report, not hidden reasoning, process commentary or a long
list of hypothetical diseases.
`.trim();
