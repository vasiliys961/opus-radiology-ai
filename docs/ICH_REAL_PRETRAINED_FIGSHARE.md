# First real pretrained hemorrhage detection on original publicly licensed CT

This task uses the **genuinely admitted** original PHE-SICH-CT-IDS
noncontrast head CT from PR #148. Actual original 512×512×25 voxel volume,
min intensity -1024, max +1813, passed full checksum and geometry
preflight in [GitHub Actions run 38733209381](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38733209381).

Real original model:
[ianpan/ct-head-hemorrhage-detection](https://huggingface.co/ianpan/ct-head-hemorrhage-detection)
release `e6d89c2`, using author-original inference.py, five segmentation
folds, classifier and sequence model checkpoints. SHA256 is independently
checked for all 8 pinned original pretrained assets. Original `skp`
package is installed from author pinned commit `098b7ff`.

On GitHub-hosted CPU, after strict >=10GiB RAM preflight, execute actual
author `HemorrhageSliceModel.predict_hu_volume` (entire native 25-slice
public NCCT, batch=1, 6 categories). The numeric-only output contains:
six subtype scores at series and slice levels, real model heatmap
candidate boxes, plus inversely projected bounded original source NIfTI
voxel/RAS regions where original geometry permits. The model is not
trained or retrained here. No APIs for patient CT and no personal cloud.

Important: model output is research only; CT intensity **looks like native
HU**, but source original DICOM RescaleSlope and RescaleIntercept were
not independently recovered from the NIfTI. The cohort's reference
annotations represent **perihematomal edema, not independently segmented
hematoma**. Hence do not infer a true positive localization, exact
hematoma volume, clinical Dice, sensitivity or absence of hemorrhage
from either model score or edema labels alone.

CI workflow: `.github/workflows/ich-ianpan-real-figshare.yml`, triggered
by the PR itself; uses no user action, MacBook GPU or private CT.
Artifacts include ONLY research JSON numbers with exact input/checkpoint
hashes. If source HU conditions or pretrained weights fail verification,
CI fails explicitly and no diagnostic claim is emitted. This is a
one-public-study implementation check, not a representative patient test.
