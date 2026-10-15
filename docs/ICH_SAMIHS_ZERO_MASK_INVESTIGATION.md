# SAMIHS: genuine pretrained CPU mask-empty investigation

## Measured source-backed baseline — 2026-10-14

Run [#38636798691](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38636798691) on main `a3c213d591f59ffd3e132fae61aef9d5f6efc03a` completed **actual pretrained SAMIHS** inference on 16 original consecutive NIfTI K-planes from public [Zenodo SAH 8228847](https://zenodo.org/records/8228847), compared with the paired expert binary mask on the same grid. The metrics artifact is `genuine-samihs-public-ct-expert-comparison` (artifact ID `11931221538`).

**Primary threshold 0.5 (not a clinical accuracy score):**

- Original source volume 193 × 229 × 193, analyzed K positions 71–86 inclusive, 16 slices.
- Expert hemorrhage volume = 8.564 mL = 8,564 positive voxels.
- Model output: zero positive voxels, TP 0, FP 0, FN 8,564.
- Dice = 0; IoU = 0; recall = 0; HD95 undefined because prediction is empty.
- Trained model CPU execution 132.21 s. This experiment does not assess complete study, sensitivity/specificity, held-out accuracy, clinical readiness or HU fidelity.
- Input Zenodo volumes are skull-stripped, normalized/resampled public scientific NIfTI, **not** original DICOM; stored intensities cannot be assumed to equal HU.
- Note: choosing an expert-positive slab biases the data and does **not** provide full study false-negative rate.

## New research-only diagnostic

On a **new explicitly operator-authorized** public-data workflow_dispatch with `--probe-empty-prediction`:

1. Preserve primary 0.5 output, its source-grid SHA, its independent Dice/HD95 and its measured execution duration.
2. Collect **aggregate only** stored NIfTI intensity percentiles (whole slab and expert-positive voxels), count near-constant source slices, and record that units are unknown/nonverified HU. Export no CT pixels, CT filenames, or new identifiers.
3. **Only if primary 0.5 prediction contains zero positive voxels**, run the exact same authenticated SAMIHS weights/source slab again at explicitly labelled **research-only threshold 0.1**; require an exact source-grid binary mask and compute its independently labelled confusion/volume statistics. Delete the secondary NIfTI output; do not upload it.
4. If secondary inference fails, record `failed_original_primary_still_valid` without vendor logs or patient identifiers. Do not overwrite or inflate 0.5 results.
5. Never claim probability calibration: the vendor exports thresholded masks, **not** a reusable raw per-voxel probability tensor. Different thresholds only show whether the vendor's binarized result changes; not whether any positive probability map matches clinical ground truth.

Original model source and checkpoint pinned by SHA. The unreviewed upstream pickle cannot be run unless explicitly authorized in a disposable research environment. Production use on real patients remains blocked; this is **not** clinical validation or a diagnostic product.

## Next evidence gates

- Run updated genuine SAMIHS workflow on public data; identify whether 0.1 probe yields positives.
- If both masks are empty, inspect vendor slice orientation/preprocessing and model-vs-public-dataset domain compatibility offline. Do not call the case normal.
- If 0.1 yields positives, compare TP/FP and prospective threshold calibration on independent cases before any recommendation.
- Do not silently threshold/reorient original values, alter expert annotations, or substitute this secondary mask for the physician's primary mask.
