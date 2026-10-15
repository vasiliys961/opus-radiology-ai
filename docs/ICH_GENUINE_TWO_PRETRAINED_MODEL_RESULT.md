# First genuine dual-pretrained hemorrhage localization comparison

**Two different pretrained neural networks REALLY ran on the same licensed,
original, source-hash-bound PHE-SICH-CT-IDS noncontrast head CT**:
512×512×25, original NIfTI SHA256
`0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`.

First network: `ianpan/ct-head-hemorrhage-detection` genuine
[Actions #38734338486](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486),
with pinned author weights, candidate subtype `intraparenchymal`
on original slice indices 9–15 (7 consecutive levels). Its full original
research JSON byte SHA256 is
`c121d869f4358de9197232fc1c6eeb5ec2f6f8977af3e28ffb8130dcba365f62`.

**Second genuine DIFFERENT model**, not first-model masking, retuning
or AI-generated ground truth: official `TotalSegmentator==2.18.0`,
`cerebral_bleed` task **150**, actual author's 325,569,459-byte
`Dataset150_icb_v0.zip` pretrained checkpoint, run on GitHub-hosted
Linux CPU
[Actions #38747034560](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38747034560).
Official published release: `v2.0.0-weights`, downloaded model archive
SHA256
`cd9a41917f134dd20f1aba877c7af4cabedf144f0f7aa1c1d16d6376b2425bb4`.
Generated original NIfTI mask SHA256
`9ef977dd844a9df2ddc547a397d1ff52b3a4284d32b4b89f2afe91321d5f5f0b`.

## Genuine observed source-space measurements

| Original CT property | Measured observed value |
|---|---:|
| Second model positive voxels | **10,875** |
| Second-model candidate-mask volume, not expert hemorrhage volume | **12.96401 mL** |
| Second-model positive voxels INSIDE first-model source-voxel bounding-box union | **10,862** |
| Proportion of second-model voxels inside first-model *bounding envelopes* | **99.88046%** |
| Second-model voxels outside first-model boxes | **13** |
| Second-model positive slice indices, 0-based | **9, 10, 11, 12, 13, 14, 16** |
| First-model subtype ROI slice indices, 0-based | **9, 10, 11, 12, 13, 14, 15** |

**The difference on original slice 16 (one-based 17) is an anatomical
review target**; we cannot call it a false positive without independent
expert label data. Some second-model pixels may occur outside boxes
on other levels too; the numeric report does not break all 13 pixels
down by slice. Do not extrapolate beyond observed evidence.

Original numeric-only uploaded Action artifact **#11980401798** has ZIP
SHA256
`e77ac758dd21e799248e448eb6afee931a39d257866c1da9ea389e259b5288a2`;
inside it, original
`opus-ich-true-two-model-research-only.json` has SHA256
`cb12ca4ae7bc115a5e82a6190cfcfa83bdadabe958227f918bd8cb94b0992234`,
size **1,781 bytes**. The byte-identical original is now stored at
`web/public/examples/ich-genuine-independent-totalseg-ianpan-run-38747034560.json`.
The physician ICH research interface can load it in one click only when
the ORIGINAL first model JSON SHA matches exactly; source and two-model
identity, coordinates, volume and absence of expert truth are
checked. No source CT pixels, patient identifiers, model checkpoints
or masks are committed.

## Boundary that must never change

The **99.88046% is model-to-model spatial containment**, NOT sensitivity,
specificity, independent radiologist expert agreement or Dice. The first
model only provided rectangular 2D source-space proposals, NOT blood
segmentation; the second model proposed a pixel-level mask. Therefore
model-to-model overlap with boxes cannot be called segmentation Dice.
The mask volume **12.96401 mL** is not a verified clinical hematoma
volume. Both models can share training/data biases; a false agreement
is possible. The original dataset's existing reference masks are
for **perihematomal edema, not blood**. Original source DICOM
RescaleSlope/Intercept are not independently available or verified.

Gemini 3.8 Flash and Opus 5.5 may act as two independently instructed
image-interpretation reviewers on rights-authorized deidentified
original pixel studies, if the imaging privacy gateway and image
capabilities are actually connected. Such visual reviewers should be
BLIND to both segmentation conclusions until their own findings are
recorded, then discrepancies can be surfaced. Two LLMs agreeing with
the segmentation still **does not establish independent radiologist
ground truth or image-label Dice**. No paid model calls were made to
prove such agreement here.

Immediate next medical work: independent expert BLOOD mask evaluation
against this same original NIfTI, or a fully authorized held-out
public ICH case with true hematoma segmentation, followed by separate
gold-standard scoring. Do not rerun these same pretrained models
on this already evaluated CT without specific scientific reason.
