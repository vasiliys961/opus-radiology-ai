# ICH research 3D candidate groups — genuine PHE-SICH-CT-IDS model output

The genuine original `ianpan` pretrained model [Action 38734338486](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486) emitted **14 class×slice proposals**, because two output channels (`intraparenchymal` and `any`) overlapped on each of seven contiguous model-ordered slices **10–16** (1-based). These 14 proposals are **NOT 14 distinct hematomas**.

`web/lib/ianpan-ich-candidate-groups.ts` now creates a source-grounded physician research *spatial proposal group* by:

- Treating an overlapping `any` proposal on the same slice as a duplicate subtype channel for visualization, not a second suspected hematoma. An `any` ROI without a matching subtype remains visible as its own unspecific candidate.
- Connecting only **consecutive model-ordered slices** of the same subtype whose original model 512×512 heatmap ROI bounding boxes overlap by >=10% of the smaller region's model-frame area. Two disconnected proposals are not silently joined.
- Computing a source-NIfTI voxel-space bounding envelope ONLY when *every* participating candidate already has an original source-native ROI geometry. Missing geometry produces `null`, never a fabricated NIfTI anatomical localization.
- Displaying the result in the ICH physician research panel with a button to filter raw slice-by-slice evidence. Research grouping and raw uncalibrated score are distinguished from published source metadata and independent expert truth.

**Actual case:** one **unverified ICH spatial model candidate group** across seven contiguous slices (14 class×slice proposals with seven redundant `any` channels), peak raw intraparenchymal score 0.975249. This is NOT a diagnosis, independent radiologist-verified true positive, hemorrhage count, voxel-level hematoma segmentation, Dice, source DICOM SOP binding, or volume in ml.

The dataset's published annotation is **perihematomal edema rather than hemorrhage**, and the public source values only appear HU-compatible (independent source DICOM rescale audit not done). Therefore no hematoma volume or clinical sensitivity is computed by this feature.
