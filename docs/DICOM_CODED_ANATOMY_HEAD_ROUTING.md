# DICOM coded anatomy: conservative head CT routing

Some valid original head CT DICOM series omit `BodyPartExamined (0018,0015)`
but include `AnatomicRegionSequence (0008,2218)`.

The metadata-only reader now recognizes **only** the exact DICOM CID 4031
`Head` coded concepts:

- `(SCT, 69536005)`: Head
- `(SRT, T-D1100)`: historical SNOMED-RT representation of Head

Source: [DICOM PS3.16 CID 4031 Common Anatomic Region](https://dicom.nema.org/MEDICAL/DICOM/current/output/chtml/part16/sect_CID_4031.html).

`Head and Neck` (e.g., SCT 774007) is not head-only NCCT and does not
automatically unlock intracranial hemorrhage detection. Unknown terminology,
a free-text Code Meaning, multiple sequence items and contradictions with
`BodyPartExamined` do not establish `HEAD`.

The code reads no patient fields and no pixel bytes; the expensive decoder
runs only when the fast metadata reader has no trusted region or encounters
a coded sequence. Full-parser fallback must preserve the same original study,
series and SOP Instance UIDs, and the same modality. This is anatomy
**routing only**; it does not claim noncontrast phase, a trained ICH
forward pass, positive pathology or clinically validated detection.

Without sufficient original source geometry, applicable real model weights,
permission to use the images and a source-bound model execution, the
detector must still fail closed.
