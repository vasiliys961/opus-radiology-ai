# Next real medical detector: pleural and pericardial effusion (CT)

The next pathology task is the openly available pretrained
[TotalSegmentator](https://github.com/wasserth/TotalSegmentator)
`pleural_pericard_effusion`, **task 315** (not the generic
`total` anatomical model). It is a separate research model trained
on a smaller specific sample, so robustness and clinical sensitivity
are not established for Opus.

**Important upstream source-class ontology (pinned TotalSegmentator
v2.18.0, `totalsegmentator/map_to_binary.py`):**

| Source label | Meaning | Pathological fluid? |
|---|---|---|
| 0 | Background | No |
| 1 | `lung_pleural`, anatomical/pleural area | **No** |
| 2 | `pleural_effusion` | Research candidate |
| 3 | `pericardial_effusion` | Research candidate |

Counting class **1** as a pleural effusion creates clinically incorrect
massive false fluid volumes. The new
`services/imaging-ai/effusion_source_evidence.py` accepts the
**original pretrained task 315 NIfTI output labelmask** as evidence,
never a synthetic predicted mask in production. It compares the
model mask to a SHA-bound original CT NIfTI of the same full grid,
checks physical original affines (all volume corners, 0.05 mm),
rejects unknown/normalized labels and reports only classes 2 and 3:
original-native source slices and 3D voxel/world coordinate envelopes,
actual model-positive voxel count, and physical candidate-mask volume
from the determinant of original CT affine. Label 1 is explicitly
excluded from all pathological volume metrics.

**No fluid segmentation result on a real chest CT is claimed yet.**
This PR is the medical source-reading component, not a pretend weight
download or pretrained inference. Before enabling the full detector
Opus must run the actual official task 315 pretrained checkpoint on
an authorized chest CT, save the untouched original task 315 label map,
verify installed weights/runtime, then attach this numeric result to
the physician CT reader. A source-mask file alone cannot prove that
real model inference took place. The numeric interface therefore
sets `actualPretrainedInferenceProvenByThisMaskAlone:false`.

An empty model fluid mask NEVER establishes absence of a pleural
or pericardial effusion. No automatic report of tamponade,
malignancy, heart failure or effusion etiology may be made from
segmentation alone. Pleural effusion and pericardial effusion are
different classes and require independent reference and clinical
review. Full clinical score calibration, source DICOM SOP mapping,
patient privacy rights and radiologist adjudication are future gates.

The CI uses tiny synthetic NIfTI labels only to test the ontology,
SHA, physical voxel geometry, actual slice indices and nondiagnostic
empty labels. It does NOT rerun heavy models or involve the owner's Mac.

Gemini 3.8 Flash and Opus 5.5 are separate visual-reasoning and
interpretive reviewers in the project's selected profile, not a
second anatomically verified effusion segmentation. Their independent
source-image observations should be compared to segmenter proposals
without feeding either model the other's conclusions first; an
LLM consensus is **not** an expert ground truth mask or clinical diagnosis.
