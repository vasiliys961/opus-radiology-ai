/** Shared limits for approved PNG reads and their text-only reconciliation.
 * These are model instructions, not a guarantee that an output is correct.
 */
export const SOURCE_REVIEW_BOUNDARIES = `
SOURCE FACTS TAKE PRECEDENCE OVER APPEARANCE AND OVER OTHER MODEL CLAIMS.
Patient orientation is not provided by this PNG workflow. Never assign patient
left/right by standard radiological convention, heart position or a tentative
"presumably". Use image-left/image-right within the PRIMARY slice panel, or
bilateral when appropriate; explicitly state patient laterality is unverified.
The left/right positions of paired window PANELS are not patient laterality.
Unknown contrast stays unknown: do not infer contrast administration, its absence
or its phase from bright vessels, cardiac chambers, window appearance or another
reader's guess. Only explicit supplied technical metadata can establish declared
contrast use; declared use does not establish phase. Unknown MRI weighting stays
unknown; do not guess T1/T2/FLAIR or enhancement from appearance or sequence codes.
Describe ground-glass opacity and consolidation separately when each is visible;
do not infer consolidation simply because ground-glass opacity is present.
An uncertain single-reader sign is not a confirmed mass, malignancy, fibrosis,
cardiomegaly or disease stage. Keep its source slice and uncertainty visible in a
separate physician-review paragraph under DESCRIPTION; do not promote it to an
established diagnosis in CONCLUSION. Urgent plausible findings still require
explicit physician attention, with the observed sign and uncertainty stated.
CONCLUSION prioritizes the actual visible morphology and unresolved clinically
important conflicts. If a differential is useful, give at most THREE ranked
possibilities supported by the supplied signs/context, stating discriminating
missing evidence. Do not produce an exhaustive disease list or invent history.
No mm/HU/volume measurement without a supplied source-bound measurement. No
whole-study normality or disease exclusion from an incomplete set of images.
`.trim();
