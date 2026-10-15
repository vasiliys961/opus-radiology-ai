# First real intraparenchymal ICH candidate trace on one public NCCT

**Status: genuine pretrained neural inference completed**, GitHub Actions
[run 38733865982](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38733865982).
**Not a clinically confirmed hemorrhage localization.**

The author-original `ianpan/ct-head-hemorrhage-detection` checkpoint
`e6d89c2`, source and original Safetensors SHA256 were verified by the
successful CPU worker. On one publicly licensed original PHE-SICH-CT-IDS
512×512×25 head CT, original intensity range −1024 to +1813 (HU-like, but
DICOM RescaleSlope/Intercept not independently checked), the genuine model
returned six series-level scores, including:

- Intraparenchymal output **0.989428** (raw, UNCALIBRATED);
- “Any hemorrhage” output **0.993365** (not a second diagnosis);
- 14 model/slice/type candidate entries at threshold 0.5: **7 IPH +
  7 overlapping broad “any”** over **original NIfTI indices 9–15**,
  corresponding to 1-indexed image slices **10–16**.
- The research-only contiguous subtype proposal forms one bounded
  NIfTI voxel envelope **[141,208,9]–[189,301,15]**, max one-slice
  IPH score **0.975249**. This is ONE connected research hypothesis,
  NOT seven hematomas, fourteen hematomas or a clinical TP.

The full genuine original numeric artifact has GitHub ID **11971696413**
and its uploaded ZIP digest is
`b9019dc3f3cc19e42a6a7402c5acb03d608c627c8d45c69cecf61952122de0a6`.
The original `opus-real-ich-public-report.json` entry SHA256 is
`471f344bab65ed17542731d2f257523ea994c9dd0338178816fb87e5b5becd65`.
The pinned source NIfTI SHA256 is
`0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`.

The public browser example
`web/public/examples/ich-ianpan-figshare-real-run-38733865982.json`
is a **curated numeric-only transcription** of those authentic original
results; it is not bit-for-bit the complete original report. Its provenance
points to the unaltered ZIP/report SHAs and real run. No CT pixels,
patient identifiers or checkpoint bytes are included.

New physician research UI in the existing ICH panel loads this actual
example without local execution or any cloud patient data. Source-projected
subtype boxes over physically consecutive NIfTI levels are combined only
when adjacent and overlapping in native XY. Distinct broad “any” predictions
are excluded from the subtype lesion-count interpretation. Real scores,
native voxel envelopes and source limitations are visible; export remains
unsigned research-only.

**Clinical and data restrictions:** the publicly published reference
masks are of perihematomal edema, **not hematoma**. There is no independent
physician-marked intraparenchymal bleeding segmentation for this exact
subject. The prediction has NOT been compared to a verified expert bleed
mask; no voxel overlap, clinically valid hematoma volume, Dice, sensitivity,
false-positive rate, held-out assessment or patient diagnosis exists.
Model heatmap pixel counts must not be converted into hemorrhage volumes.
Do not present absence of proposals as a negative diagnostic CT. Merging
this PR makes the real numeric outcome inspectable by physicians; the next
true diagnostic research milestone is acquiring lawful *expert hematoma*
masks matching the same CT source.
