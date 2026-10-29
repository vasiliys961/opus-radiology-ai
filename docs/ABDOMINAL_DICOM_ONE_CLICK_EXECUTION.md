# Original abdominal CT auto-start · two distinct existing tasks

Open a source-verified CT abdomen DICOM series in \`/viewer\`; press **Анализировать
исследование**. The frontend converts the **selected original source** to an exact
native-HU NIfTI once (OPFS, bounded streaming), then sends it to a private
authenticated Linux worker at \`http://127.0.0.1:8775\`.

The worker executes installed original TotalSegmentator 2.18.0 models:
1. \`kidney_cysts\`, two original class labels (left/right).
2. \`liver_lesions\`, one focal lesion class.

Each pathology task is executed **once**. Other existing anatomical kidney/liver
segmenters are *not* counted as duplicate pathology detectors. A missing task
stays unavailable; the other task can still complete. This is an opt-in
nonpatient public research source pipeline, **not clinical patient approval**.

Required host: Linux, >=10GiB free RAM, OS-enforced network isolation,
preinstalled approved original weights and separately validated rights.
No checkpoints, pixels or tokens are committed to git.

Run from \`services/imaging-ai\` with the original installed checkpoints:

\`\`\`sh
python abdominal_ct_pathology_direct_worker.py \
  --kidney-checkpoint /private/weights/kidney/checkpoint_final.pth \
  --kidney-sha <exact-64-lowercase-hex> \
  --liver-checkpoint /private/weights/liver/checkpoint_final.pth \
  --liver-sha <exact-64-lowercase-hex> \
  --pancreas-checkpoint /private/weights/pancreas/original-model.ts \
  --pancreas-sha <exact-64-lowercase-hex> \
  --origin http://127.0.0.1:3000
\`\`\`

Any of the three task checkpoints may be omitted; missing task must show
"not assessed", never a negative diagnosis. Copy the printed temporary
session token into the application's **advanced worker settings**. The worker
does not invent source DICOM identity; it verifies the NIfTI source SHA and
model output geometry. The UI may navigate to an *approximate corresponding*
native K index; this cannot substitute original SOP-pixel registration.

The physician sees the true positive candidate class, actual model candidate
voxel volume, and a provisional editable note. No Bosniak score, liver
malignancy classification or no-disease assertion is made. No independent
clinical validation; Gemini+Opus remains separately permissioned for actual
deidentified frames and cannot serve as a validation substitute.
