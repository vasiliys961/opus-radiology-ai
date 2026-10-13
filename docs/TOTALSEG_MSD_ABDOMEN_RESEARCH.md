# Public abdomen CT: real trained TotalSegmentator and independent spleen Dice

**Research-only, opt-in.** Next milestone after technically verified CT lung lobes,
and CT abdomen routing in PR #72. [Official TotalSegmentator task list](https://github.com/wasserth/TotalSegmentator):
multilabel task \`total\` uses **1 spleen, 2 kidney_right, 3 kidney_left, 5 liver**.
The installed 3 mm/6 mm public weight checkpoints (297/298) can be reused
with the exact task and the four-structure ROI. No new closed models, tokens or
new paid inference provider are needed.

Reference: [Medical Segmentation Decathlon Task09 Spleen](https://registry.opendata.aws/msd/),
CC BY-SA 4.0. MONAI's documented download:
\`https://msd-for-monai.s3-us-west-2.amazonaws.com/Task09_Spleen.tar\`,
published checksum MD5 \`410d4a301da4e5b2f6f86ec3ddba524e\`.
The script only accepts a fixed **training** case \`spleen_2.nii.gz\`,
extracting the full original 3D CT and its **independent binary spleen
ground truth**. The official MD5 is a transport integrity check, *not*
cryptographic provenance or clinical approval. Original input pixel intensities
are preserved in NIfTI float32 with the native geometry, without resizing.
The dataset is public image research data; review licence before other use.

Manual GitHub Actions:
\`.github/workflows/totalseg-msd-abdomen-public-ct.yml\` → main → Run workflow.
The workflow downloads & digest-checks the public dataset (approx 1.6 GiB),
checks source/annotation geometry, provides pretrained weights, runs real
TotalSegmentator CPU in a **network-disabled**, read-only container, validates
native-grid labels, then computes **actual spleen Dice vs original ground truth**.
Reports exact model/CT/mask SHA and aggregate organ label counts, and only one
independent Dice metric. All CT, masks, checkpoint data and files are deleted
even on failure; no DICOM, NIfTI, artifacts, medical images or screenshots
are uploaded to GitHub.

Crucial boundaries: **liver and kidney reference masks do not exist in Task09**,
so their Dice values are **null**, NOT zero and NOT implied perfect. A public
spleen-training case is a preliminary demonstration, not a held-out,
multi-center clinical benchmark. Volume may not fully contain all four
organs: zeros or partial organs need review, not a "normal" conclusion.
This workflow does not authorize arbitrary patient data, local M1 RAM,
licence approval, GPU inference or clinical diagnosis. The first real
inference has **not** happened merely by merging the PR; it must be
manually started and audited after full CI.



## Actually observed manual public-CT inference (2026-10-13)

**PASSED:** [Actions run #38358366427](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38358366427).
Public MSD **training** case \`spleen_2\`, exactly 512×512×90 source voxels.
The trained TotalSegmentator CPU \`total --fast --roi_subset\` inference
completed in **32.51 s**, exit code 0, independent annotation scorer passed.

| Label | Organ | Voxels | Independent Dice |
|---|---|---:|---:|
| 1 | Spleen | 94,852 | **0.947923** |
| 2 | Right kidney | 54,253 | Not available |
| 3 | Left kidney | 59,127 | Not available |
| 5 | Liver | 591,948 | Not available |

Spleen ground truth: **96,672** voxels; intersection **90,775**.
\`Dice = 2 × 90,775 / (94,852 + 96,672) = 0.947923\`.
The original source SHA, actual trained-model mask SHA and independent
reference SHA, and the exact aggregate observations, are now captured at
\`docs/verification/totalseg-msd-abdomen-real.json\`; no images or
reference masks were published.

**Limits:** one training example, not a clinical validation cohort or
population-level performance estimate. Predicted kidney and liver voxels
are not independently verified. Neither model labels nor occupied region
prove full-organ anatomy. No real patient cloud API or Safari/M1 workflow
has been enabled. Do **not** rerun inference to calculate physical label
volumes: the native label count + validated NIfTI mm-grid determinant
suffice; absence of validated units must return \`null\`, not a guessed mL.


## Four-organ 32-slice MPR research review (new browser UI; not patient-approved)

The **native full mask 512×512×90 is too large for the current 8,388,608
voxel browser limit**. Use the extended source-bound
\`scripts/extract-totalseg-mpr-slab.py --research-profile abdomen-four-organs\`
to extract a **contiguous original-grid 32-slice** fragment, preserving
mask voxel labels and shifting the NIfTI sform by the exact slice offset.
The generated \`.nii\` and
\`opus-totalseg-abdomen-native-mpr-slab/v1\` JSON passport can be selected
together under **Маска TotalSegmentator + паспорт исследования** in MPR.
The existing viewer validates 3D geometry of the mask against the **original
matching DICOM slices**. If the mask does not match the source DICOM grid,
it is rejected. Four fixed classes are shown in Russian and offer bounded
occupied-voxel MPR navigation. A missing class is flagged, never called normal.

Important: **MSD Task09 provides NIfTI CT, not DICOM**, and this release
does not add NIfTI CT background rendering. Thus the official MSD test
verifies the full 3D anatomy masks and independently scored spleen Dice;
it **does not** demonstrate those masks displayed over MSD CT in the current
DICOM-only browser viewer. For local review, retain a lawful compatible
DICOM source or implement separately verified NIfTI CT viewing before
claiming source-image overlay. This manifest cannot prove patient identity
or the origin of the model even if its SHA matches the mask.

For **future** manual workflow runs, the script produces an ephemeral
32-slice mask with source range 25–56 and a four-organ proof before data
cleanup. It does NOT upload masks or source images as CI artifacts. The
already successful full model run does not need to be repeated to add
this code; no new real browser observation is claimed.
