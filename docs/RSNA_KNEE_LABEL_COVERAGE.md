# Knee MRI label coverage audit

Before using radiology report text to expand training, inspect which of the 12 target labels are actually explicit and whether each class contains both positives and negatives:

```bash
python services/imaging-ai/rsna_knee_label_audit.py \
  --train-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv \
  --out /kaggle/working/knee_label_coverage.json
```

Outputs only aggregate label counts (no patient, DICOM or report text). Explicit `0` and `1` are gold labels; empty or invalid entries stay unknown. Report text cannot safely be promoted to a negative label by keyword absence. Before training on additional report-derived pseudolabels, sample positive/negative examples per pathology and document reviewer error rates.
