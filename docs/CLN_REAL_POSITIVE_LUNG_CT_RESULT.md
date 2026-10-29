# CLN real positive lung CT: completed original model forward

**Evidence:** [GitHub Actions 40956762777](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/40956762777), artifact `cln-genuine-single-positive-CT-CPU-voxels` (numeric-only). Original model `Lab-Rasool/CLN-Segmenter-MSD-fold0`, SHA-256 `8c08ec796fa2b786fe99ddfad4fe6314e98fdd8820c59527be3c4105f7955d87`.

**Positive source:** public MedOtter/msd-lung `lung_043.nii.gz`, revision `8788e7233406875cf5f2366cf27f8f155fb7a8cf`. Source CT SHA-256 `08b7aa88ee9946b0bf0a5fcd08af1d9b7720c4295e4f900a3e2f13d5c3b6b694`, expert mask SHA-256 `cc593eb359bc530642386b8fa1760fc2c2e8c45fe2a8faae62ff321f3dd8d689`.

| Actual original 3D CPU inference | Observed |
|---|---:|
| Forward completed | Yes |
| Positive expert tumor mask | 1,912 voxels |
| Model positive voxels | 1,556 |
| Model volume | 2.303572 mL |
| Model candidates | 1 |
| Candidate intersecting provided expert lesion | 1 |
| Expert lesions missed by any-overlap | 0 of 1 |
| Voxel TP / FP / FN | 1,411 / 145 / 501 |
| Voxel Dice | 0.8137254901960784 |
| Peak monitored process RSS | 10,579,451,904 bytes |
| Native NIfTI geometry verified | Yes |
| Original DICOM SOP/LPS registration | **No** |
| Independent held-out clinical validation | **No** |

**Detected model region:** native IJK bounding box [[129,163],[220,242],[96,103]], centroid IJK [148.04,231.323,99.345], NIfTI RAS [79.364,-26.338,-57.137] mm.

**Clinical interpretation:** This is one authentic positive MSD-family training/validation-ambiguous case and is not evidence of general diagnostic sensitivity, specificity, clinical utility, or a safe negative result. No patient data were transmitted. A separate source-independent expert-positive CT and a directly installed physician app worker are still needed. Do not display NIfTI RAS as DICOM LPS without verifying registration.
