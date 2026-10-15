# MRI intensity preprocessing, experimental

Old checkpoints and model runs use `pixel_mode=legacy`, preserving the original percentile-window conversion.

New optional `--pixel-mode dicom` applies RescaleSlope/RescaleIntercept (if present), handles nonfinite values, and inverts MONOCHROME1 to keep consistent grayscale polarity. MRI intensities remain relative rather than true tissue-density values. The new mode is used consistently across training, held-out validation and offline prediction because it is stored in the checkpoint.

```bash
python services/imaging-ai/rsna_knee_compare.py --series-selection balanced --pixel-mode dicom --work /kaggle/working/dicom_pixel_experiment
```

No ROC-AUC benefit has been demonstrated; genuine MRI DICOM and GPU checks remain necessary. A new checkpoint is needed for the new preprocessing pipeline. No data leaves the Kaggle environment.
