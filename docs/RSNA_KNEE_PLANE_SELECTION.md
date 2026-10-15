# Plane-balanced MRI series selection

The original `study_slices` chose the first series by sorted SeriesInstanceUID, which does not represent a clinical acquisition order. It now iterates deterministic sagittal, coronal, axial round-robin series from `Anatomical_Plane` metadata, preserving the original `series_index` shape.

**Compatibility warning:** this changes which images are fed to the model. Previously trained ResNet18/DINOv2/CoAtNet checkpoints were trained using sorted-series selection and **must not be silently reused** with the new selection. Validate preprocessing provenance or use the legacy selection at inference until the new protocol is trained and evaluated. This change does not claim better AUC, and sequence types (T1/T2/PD/FS) are not yet identified reliably.
