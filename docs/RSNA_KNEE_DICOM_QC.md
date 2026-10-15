# Knee DICOM input quality audit

Run this locally in Kaggle without GPU:

```bash
python services/imaging-ai/rsna_knee_dicom_audit.py --dicom-root /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series --series-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series.csv --out /kaggle/working/knee_dicom_quality.json
```

This header-only aggregate report identifies missing series, duplicated instance numbers or image positions, partial InstanceNumber metadata, insufficient slices and incomplete plane coverage. No images or identifiers are included in the resulting JSON. The report intentionally does not claim clinically meaningful anatomical coverage; it informs a future, versioned slice-ordering experiment. This check uses CPU and does not change training or pre-existing checkpoint behavior.
