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

## OBSERVED true pretrained inference (15 October 2026)

**Completed** the genuine original model on the original verified public
512×512×25 source in GitHub Actions [run
38733865982](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38733865982).
The workflow finished SUCCESS, including CPU execution and SHA-256 gates for
all eight author-model artifacts. Numeric-only original ZIP artifact:
`real-pretrained-ich-figshare-original-ct`, GitHub artifact ID
`11971696413`. Its full original JSON was independently downloaded and read
after the finished Action, with no checkpoint or CT image copied to the app.

Direct observations:
- Source NIfTI SHA-256 `0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`.
- True actual CPU inference elapsed **41.45 seconds** (not the complete workflow).
- Original full model-ordered CT: **25 slices**. Published CT source, original
  intensity range **−1024 to +1813**, still not independently DICOM-rescaled.
- Uncalibrated series model scores (not patient disease probabilities):
  intraparenchymal **0.989428**, any ICH **0.993365**, epidural 0.003299,
  intraventricular 0.007087, subarachnoid 0.040550, subdural 0.022220.
- **14 heatmap-box category proposals** at research threshold 0.5, consisting
  of intraparenchymal and any ICH results on exactly **seven sequential
  original model-ordered slices 9–15 (zero based)**, i.e. source slice
  labels **10–16**. A sample intraparenchymal box on slice 10 has model
  input XY [143,236,177,284], uncalibrated slice score 0.967383, and
  inversely projected original NIfTI XYZ voxel box [143,227,9,177,275,9].
- **All source-ROI proposals remain medically unconfirmed**:
  `independentlyClinicallyVerified:false`; no matched expert HEMATOMA
  mask, voxel-level Dice, sensitivity or clinical diagnosis. Perihematomal
  edema masks cannot be substituted for hemorrhage masks.

The browser research report now ships a parsed numeric sample in
`web/public/examples/ich-ianpan-real-figshare-run-38733865982.json`, linked
back to the original GitHub Actions archive, and the ICH research viewer
can load it with one click. It remains separate from any uploaded patient
DICOM; no clinical use and no automatic negative conclusion.
