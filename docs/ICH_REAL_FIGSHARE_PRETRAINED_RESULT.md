# True pretrained ICH output on one licensed original public hemorrhagic CT

**Successful independent execution:** [GitHub Actions #38734338486](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486), 2026-10-15.

## Clinical-research facts actually observed

- Published, freely licensed Figshare PHE-SICH-CT-IDS (CC BY 4.0), source article 23957937, archived ZIP file 63081925 (1,300,209,108 B, publisher MD5 metadata `a2c3f32f11478167b975d5036edbb510`).
- The archive was **not downloaded in full**. Fixed remote ranged reads selected ONE original NIfTI CT, verified central-directory/local entry, CRC32, uncompressed original NIfTI voxel values and affine. The scan was 512×512×25, observed intensity −1024 to 1813, HU-LIKE but **NOT independently proven HU from raw original DICOM RescaleSlope/Intercept**. Source resulting NIfTI SHA-256 `0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`.
- Actual published `ianpan/ct-head-hemorrhage-detection` seven pretrained Safetensors checkpoints + original `inference.py` matched all hardcoded published SHA-256s at revision `e6d89c2`; original pinned `skp` author code was executed, not random or synthetic checkpoints. Complete 25-slice CPU inference completed in **27.986 s** (excluding installation/checkpoint download).
- Raw, **uncalibrated series model outputs**:

| Category | Model score (not a clinical probability) |
| --- | ---: |
| Epidural | 0.003299 |
| Intraparenchymal | **0.989428** |
| Intraventricular | 0.007087 |
| Subarachnoid | 0.040550 |
| Subdural | 0.022220 |
| Any hemorrhage | **0.993365** |

- At *research-only* threshold 0.5, **14 class-by-slice candidate records**, not 14 separate hematomas. They cluster on the same **seven original-model slices 10–16 (1-based)**: each has an `intraparenchymal` and an `any` candidate. Top slice-specific raw score: `any` 0.978335 on 1-based slice 15, and `intraparenchymal` 0.975249 on that same slice.
- True model-input 512×512 masks were transformed via pinned original NIfTI-to-LPS axes to **source-native NIfTI voxel bounding ROIs and physical RAS mm envelopes**; source frame geometry calculation is implemented, but spatial accuracy relative to a radiologist's hemorrhage contour is NOT independently proven. No clinical hematoma volume or source-voxel segmentation mask can be inferred from enclosing boxes.

## Unresolved clinical safety gates

**No independent published hematoma expert segmentation or label has been matched to this individual CT.** PHE-SICH-CT-IDS includes *perihematomal edema* annotations. Those are **NOT hematoma expert masks** and cannot produce true positives, Dice, hemorrhage volume, sensitivity or specificity. The dataset title's SICH cohort and the model's high scores are not a substitute for independent physician adjudication.

Unlike MONAI LUNA16's single case with an independently published expert nodule center (0.884 mm), **this ICH result remains a real nonzero *candidate localization*, not a verified true-positive hemorrhage**. One case cannot establish clinical performance; a separate, legal independent cohort with genuine hemorrhage masks/negative cases and source DICOM HU audit is necessary for validation. No negative clinical clearance allowed.

## Reproducible evidence and product wiring

- Truthful zero-IHC prior SAMIHS remains unchanged: 8,564 expert-positive voxels, TP0/FP0/FN8,564, Dice 0 in previous Zenodo public SAH slab at thresholds 0.5/0.1. Do NOT rerun it to generate fictional success.
- This separate ianpan model actually ran successfully in [run 38734338486](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486). Numeric-only GitHub artifact `real-ich-model-output-figshare-single-public-ct`, SHA-256 of extracted exact JSON **`c121d869f4358de9197232fc1c6eeb5ec2f6f8977af3e28ffb8130dcba365f62`**. Also preserve verbatim under `web/public/examples/ianpan-ich-real-figshare-run-38734338486.json` via the constrained evidence-archive workflow; never include CT pixels, DICOM or raw masks in the commit.
- The existing physician ICH research component imports JSON and displays type, slice, input heatmap rectangle and source NIfTI voxel/RAS box. It explicitly warns published HU is only plausible, not DICOM-rescale audited, and reference masks are edema not hemorrhage. Do not promote the report to patient-mode diagnosis.

Priority next development: **present this exact evidence automatically** as a real public example in the ICH clinician research UI, and identify an *independently hematoma-annotated* CT dataset before any claims of verified bleeding lesion/detection performance.
