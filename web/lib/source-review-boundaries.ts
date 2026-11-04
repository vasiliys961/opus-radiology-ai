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
No mm/HU/volume measurement without a supplied source-bound measurement.
Do not confirm histology, cancer as a proven fact, TNM or a disease stage.
`.trim();

/** The physician-facing answer is a diagnosis of what these images show. */
export const DIAGNOSTIC_READING = `
LEADING RADIOLOGICAL DIAGNOSIS:
Diagnose only anatomy visible on the supplied images and in the supplied window.
A lung window supports aerated lung, airways and free air. A soft-tissue window
supports solid organs, mediastinum, nodes, heart, vessels, bowel and chest wall.
A bone window supports cortical bone. A brain window supports brain, ventricles
and extra-axial spaces. Do not diagnose an organ from a window that does not show it.
The sign is one Russian diagnosis. Start it with "КТ-признаки", "МР-признаки"
or "подозрительно в отношении". Morphology is the visible evidence.
A negative is allowed only for the supplied slices and the supplied window, written
as "на этих срезах в этом окне искомого нет". Do not write that the organ, the
series or the study is normal, and do not write "без патологии" unless every
original slice was reviewed and this window shows that organ.
Uncertainty names one competing diagnosis only when it would change the leading
diagnosis. Forbidden as the sign: homogeneous attenuation, no gross wall thickening,
standard folds, maintained cortical outlines, regular contour, evaluation limited,
single-plane sampling, partial visualization, not assessed, clinical correlation,
cannot exclude.
`.trim();

export type DiagnosticRegion='HEAD'|'NECK'|'CHEST'|'ABDOMEN'|'PELVIS'|'SPINE'|'EXTREMITY'|'UNKNOWN';

const CT_WINDOW=`Name the window that supports each diagnosis. The left panel is the primary window and the right panel is the additional window. A lung window diagnoses aerated lung, airways and free air. A soft-tissue window diagnoses solid organs, mediastinum, nodes, vessels, bowel and chest wall. A bone window diagnoses cortical bone. Diagnose each structure from the panel that shows it.`;
const MR_WINDOW=`Diagnose from the supplied MR images. Do not invent sequence weighting or contrast enhancement. The diagnosis must name the signal pattern that supports it.`;

const CT_SEARCH:Record<DiagnosticRegion,string>={
 CHEST:`Chest CT. Diagnose lung parenchyma and airways on the lung window, pleura, and on the soft-tissue window the mediastinum, nodes, heart and vessels. Actively evaluate visible mediastinum, nodes, heart, vessels and chest-wall tissues when that panel is present. Diagnose gross bone destruction when bone is visible.`,
 ABDOMEN:`Abdomen CT. Diagnose on the soft-tissue window: liver and intrahepatic ducts, gallbladder and bile duct, pancreas, spleen, adrenals, kidneys and collecting systems, bowel wall, free air, free fluid, vessels and nodes. Do not apply a chest checklist to these organs.`,
 PELVIS:`Pelvis CT. Diagnose bladder, included reproductive organs, rectum, nodes, vessels and bones that are in these slices.`,
 HEAD:`Head CT. Diagnose brain parenchyma, ventricles and midline, extra-axial spaces, skull and scalp that are in these slices.`,
 NECK:`Neck CT. Diagnose airway, thyroid, vessels, nodes and soft tissues that are in these slices.`,
 SPINE:`Spine CT. Diagnose vertebral body, spinal canal, disc space if included, and paraspinal tissues.`,
 EXTREMITY:`Extremity CT. Diagnose bone, joint, effusion and soft tissues that are in these slices.`,
 UNKNOWN:`Name the body region shown and diagnose only that region. Chest: lung, airways, pleura, mediastinum. Abdomen: liver, bile ducts, gallbladder, pancreas, spleen, adrenals, kidneys, bowel, free fluid. Pelvis: bladder, rectum, nodes. Head: brain and ventricles. Spine: vertebral body and canal. Do not recite regions that are absent.`,
};
const MR_SEARCH:Record<DiagnosticRegion,string>={
 HEAD:`Brain MRI. Diagnose signal change, mass effect, ventricular size and midline shift, and extra-axial collections that are visible. Do not claim ischemia, hemorrhage or metastases without the sequence that shows them; diagnose the pattern that is visible.`,
 SPINE:`Spine MRI. Diagnose cord signal, canal compromise, disc and vertebral signal that are visible.`,
 ABDOMEN:`Abdominal MRI. Diagnose the visible solid organs, ducts, collections and focal signal changes.`,
 PELVIS:`Pelvic MRI. Diagnose the visible pelvic organs, collections and focal signal changes.`,
 CHEST:`Chest MRI. Diagnose the visible mediastinum, pleura, chest wall and focal signal changes.`,
 NECK:`Neck MRI. Diagnose the visible airway, glands, nodes and focal signal changes.`,
 EXTREMITY:`Extremity MRI. Diagnose the visible bone, joint, effusion and soft-tissue signal changes.`,
 UNKNOWN:`Name the body region shown and diagnose its visible signal pattern. Do not recite organs that are absent and do not invent the sequence.`,
};

export function anatomySearch(region:DiagnosticRegion,modality:'CT'|'MR'):string{
 const table=modality==='CT'?CT_SEARCH:MR_SEARCH;
 return (modality==='CT'?CT_WINDOW:MR_WINDOW)+'\n'+(table[region]??table.UNKNOWN);
}
