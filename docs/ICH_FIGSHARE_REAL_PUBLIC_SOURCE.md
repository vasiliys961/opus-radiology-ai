# Original public hemorrhagic NCCT source: PHE-SICH-CT-IDS

Study: Ma et al., *PHE-SICH-CT-IDS: A benchmark CT image dataset
for evaluation semantic segmentation, object detection and radiomic feature
extraction of perihematomal edema in spontaneous intracerebral hemorrhage*,
Computers in Biology and Medicine 173 (2024), 108342, DOI
10.1016/j.compbiomed.2024.108342.

Official public dataset [Figshare article 23957937](https://figshare.com/articles/dataset/PHE-SICH-CT-IDS/23957937)
is explicitly CC BY 4.0 with 120 original 3D CT volumes from patients
with spontaneous intracerebral hemorrhage (SICH) and associated masks of
**perihematomal edema**, NOT hemorrhage ground truth. A CSV may include
personal/clinical attributes; no patient metadata is downloaded or used.
No RSNA/CQ500 mirrors, no user-owned private CT.

Original publisher 1.3 GB ZIP file ID `63081925`,
size `1300209108`, official Figshare computed MD5
`a2c3f32f11478167b975d5036edbb510`. Instead of downloading the whole
cohort, the bounded research script uses confirmed HTTP 206 byte ranges to
read the remote ZIP central index and exactly one original gzip NIfTI
member from the source CT subset `SubdatasetA_NIFIT`. It cross-checks the
central ZIP CRC-32 and local member header, then records SHA256 of the
actual downloaded original NIfTI gzip. The published whole-archive MD5
is observed from official metadata, **not independently recomputed**
when obtaining one original member via HTTP Range. The script explicitly
does not pretend these provide equal evidence.

Scientific source gate: a 3D original volume with finite CT-like
intensities including plausible air (< -450) and dense bone (> 150),
spatial axes, source geometry and volume size; it refuses cropped
normalised or only-windowed images rather than inventing HU. Even after
this admission, original per-slice DICOM RescaleSlope/Intercept remains
**NOT independently verified**; no legal/private DICOM credentials used.

The original full volume with same affine/intensities is converted to a
bounded research float32 .nii and bound to a numeric-only SHA256 manifest.
No DICOM identifiers or images are written to GitHub, stdout or CI
artifacts; disposable runner files are deleted on success or failure.

**Clinical scope:** all 120 original studies were selected for
spontaneous ICH according to the dataset publication, but which bleeding
type or precise lesion the network finds in a chosen series cannot be
asserted as independently established without a matched independent
hematoma mask. The reference masks published with this dataset are for
*perihematomal edema* and may NOT be reported as segmented blood.
A model prediction alone is not a true-positive lesion or a diagnosis.

The initial PR CI exercises genuine public original acquisition and HU
checks **without downloading any neural network checkpoint**. Only when
that real source gate passes should the existing separate pinned ianpan
hemorrhage detector be executed on the same SHA-bound source, with
full genuine pretrained checkpoint integrity verification. Any
independent hematoma-mask Dice, sensitivity or clinical performance
is not established by this workflow.
