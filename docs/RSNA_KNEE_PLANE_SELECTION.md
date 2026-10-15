# Opt-in MRI plane-balanced selection

Legacy `series_index` and the default `study_slices(..., series_order="legacy")` preserve exact sorted-series behavior for previously trained checkpoints.

For **new experimental training only**, first call `balanced_series(read_rows(series_csv), max_series=3)`; then pass that index into `study_slices(..., series_order="provided")` so sagittal, coronal and axial series are sampled in balanced order. Callers must opt in; no existing model or inference uses the new mode automatically.

These series are categorized by Anatomical_Plane; this is not sequence-type recognition (T1/T2/PD/FS). New training and evaluation are required before claiming benefits. Existing DINOv2/CoAtNet weights should continue to use the legacy mode.
