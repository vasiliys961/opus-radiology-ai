# Genuine ICH source-space candidate continuity — one public case

This is medical research functionality, **not model re-inference or repeated
infrastructure testing**. It uses the original, byte-identical numeric-only
real pretrained ICH output already stored by PR #153:

- Original licensed public PHE-SICH-CT-IDS NIfTI CT: **512×512×25**,
  HU-like intensities −1024…+1813. DICOM RescaleSlope/Intercept were
  **not** independently available/verified.
- Successfully executed genuine pretrained ianpan ICH classification and
  heatmap localization in [GitHub Actions run 38734338486](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486),
  with the publisher's SHA-256-verified original weights and CPU execution.
- Original numeric evidence (not a reconstruction or mock):
  `web/public/examples/ianpan-ich-real-figshare-run-38734338486.json`.
  Source CT SHA256:
  `0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`.

**Actual measurement in this one case:** 14 subtype/slice records above raw
score 0.5 are *not 14 hematomas*. Seven are class `intraparenchymal`,
and seven are broad `any` on the same seven model/source axial indices
9–15 (10–16 when counting displayed slices from one). Source-native
IPH region bounds enclose `[141,208,9]–[189,301,15]`, with one-slice
max raw IPH score `0.975249`, and original model-produced per-slice
heatmap candidate pixels only. The full-series IPH score is `0.989428`;
`any` is `0.993365`. These scores are **uncalibrated**.

`web/lib/ich-real-lesion-tracks.ts` groups consecutive source-space
candidate proposals of the **same specific subtype** only when their
original-voxel XY envelopes overlap and source slice numbers differ by
exactly one. The broad `any` channel is *excluded from separate-lesion
counting*. Disjoint, missing-source-projection and nonadjacent candidates
remain distinct/ungrouped. The interface presents research tracks and a
bounded 3D native-voxel envelope, so a physician can understand where
further visual review is needed. Notes export preserves these as
**unverified proposals, not hematoma measurements**.

**Boundaries that must not change:** the published PHE-SICH-CT-IDS
reference masks delineate *perihematomal edema*, not separately verified
hemorrhage regions. Even when 3D boxes overlap, Opus has NOT verified
a model-to-expert hematoma TP/FP/FN, volume, voxel Dice, external clinical
sensitivity, or radiologist-reviewed localization. Sum of heatmap
pixel-count observations is NOT a source-space hematoma volume.
A negative model score must not be translated into a normal head CT.

Only the existing numeric source-bound real model report is used in tests;
no new GPU or CPU inference, no new model/checkpoint installation, no
pixel upload, no patient CT or human clicking required.
