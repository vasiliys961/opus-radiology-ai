# Knee MRI sequence metadata coverage

Run without GPU using the competition's local series CSV:

```bash
python services/imaging-ai/rsna_knee_sequence_audit.py --series-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series.csv --out /kaggle/working/knee_mr_sequence_coverage.json
```

The report contains aggregate metadata counts only (no DICOM images, reports, identifiers or source data). Optional fields `SeriesDescription`, `Series_Description`, `ProtocolName`, `ScanningSequence`, and `SequenceName` are searched. If the source CSV omits these descriptions, the analyzer properly reports `unknown`; it does not pretend to know T1/T2/PD from a series ID or orientation alone.

This is metadata QA, not radiological sequence validation, and is not connected to pretrained checkpoint inference.
