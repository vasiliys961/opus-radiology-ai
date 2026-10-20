# Original MONAI renal-neoplasm segmentation — THREE-PHASE contrast CT

**Anatomic expansion: renal neoplasm.** Original research model:
https://github.com/Project-MONAI/model-zoo/tree/dev/models/renalStructures_CECT_segmentation

Author: Chernenkiy et al., Sechenov University (2023). Model zoo code and
bundle include Apache-2.0 license; underlying **patient source/annotations
CC BY-NC-SA 4.0**, do not redistribute or use without separate clearance.

Real pretrained checkpoint is the publisher's `models/model.pt` downloaded
from the `large_files.yml` Google Drive address and independently compared
against published MD5 `164752169d98459d30592d72a3fa86f4`.
Metadata claims bundle v0.2.4; three input channels, SegResNet 3D,
six output channels, neoplasm output channel **4**. Author reports
renal-neoplasm Dice ~0.58 in its validation set, **not an Opus result**.

**Actual code**:
`scripts/real-monai-renal-neoplasm-3phase.py` is a research CPU-only
inference executor for three pre-cropped, co-registered kidney ROI studies:
1. arterial contrast phase CT;
2. venous contrast phase CT;
3. excretory phase CT.

The code checks exact source affine, shape, physical units, bounded voxel
count and official model MD5. It reproduces the model's LPS orientation,
0.8-mm spacing and -1000..1000 HU intensity scaling, loads actual original
SegResNet checkpoint weights only via safe PyTorch weights-only state loading,
runs the genuine model in 96^3 overlapping windows, then selects the published
neoplasm raw output channel 4 with sigmoid threshold 0.5. It returns a native
arterial CT grid binary candidate mask, individual candidate boxes/centroids,
ml volumes and optional TP/FP/FN/Dice against a separately supplied ORIGINAL
expert **binary neoplasm mask**.

**Important protocol distinction:** This research code selects raw neoplasm
channel 4 before the author's final custom `MergeClassesd`; it is NOT an exact
reproduction of the bundle's complete multi-class merge policy. Until a real
trained forward has been run and checked, no detection quality, operating
threshold or sensitivity is claimed. The published `pred_classes` list maps
channel 4 to neoplasm; it is NOT channel 5 and cannot be inferred from the
separate ground-truth `label_classes` list.

No automatic full-CT kidney ROI detection, registration, or processing of
an arbitrary single-phase study is supplied. Missing phases mean
UNSUPPORTED, not a negative tumor screen.

Run on a separate protected CPU worker only after original weights and
three licensed research CT phases are available. Example:
```bash
python scripts/real-monai-renal-neoplasm-3phase.py \
 --artery /research/case/arterial.nii.gz \
 --vein /research/case/venous.nii.gz \
 --excretory /research/case/excretory.nii.gz \
 --checkpoint /research/original-monai/models/model.pt \
 --out-mask /research/output/neoplasm.nii.gz \
 --report /research/output/neoplasm-evidence.json \
 --approved-public-three-phase-ROI --isolated-research-worker
```

No patient mode, commercial permission inference from data license, or cloud
transmission has been enabled. This branch includes no original images, weights
or numeric trained-model outcome. Verify on a legal expert-positive public
three-phase dataset before any claim of accuracy.
