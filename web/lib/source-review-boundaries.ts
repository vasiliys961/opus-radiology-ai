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

/** Available anatomy must be described; task-specific limits must not erase visible findings. */
export const AVAILABLE_ANATOMY_REVIEW = `
Evaluate ALL visible anatomical structures using ALL supplied display windows,
including the additional panel. A limited slice range does not make anatomy
visible on those slices unassessed. Describe the visible part, then state what
cannot be assessed beyond that part. Do not use a blanket list of unassessed organs.
For chest CT systematically cover lung parenchyma, visible airways, pleura,
mediastinum and visible lymph nodes, heart and great vessels, bones and chest wall.
If a structure is outside these levels, obscured or not diagnostically visible,
name that specific reason. Do not mark it not_assessed merely because a full
series, another window or contrast phase is missing. With soft-tissue panels,
actively evaluate visible mediastinum, nodes, heart, vessels and chest-wall tissues.
Without angiographic contrast, describe visible vessel morphology but do not
exclude embolism or characterize enhancement. Without a dedicated bone window,
describe visible gross osseous changes and state limits for subtle lesions; do
not claim a complete bone assessment. Bounded supported negative observations
are permitted ONLY for the actual visible structures, levels and windows.
`.trim();
