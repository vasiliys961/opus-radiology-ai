# Doctor Opus → Opus Radiology AI: review and selective migration

Reviewed on 2026-10-10 from `vasiliys961/doctor-opus` default branch.
Source application stays unchanged. This document is an engineering review, **not** a clinical assessment of the product.

| Source | Useful parts | What must be improved for Radiology AI |
|---|---|---|
| `lib/dicom-service.ts` | Use of `dicom-parser`, technical metadata extraction | Patient age/sex, descriptions and device fields are **potentially identifying**. Enforce minimal metadata selection, data classification, consent and de-identification before external transmission. |
| `lib/dicom-client-processor.ts` | Browser-side decoding, thumbnails and stack interaction ideas | It uses legacy `cornerstone-core` and `cornerstone-wado-image-loader`. Thumbnail sampling (`maxFrames=12`) is **not** a substitute for reviewing a volumetric examination; don't feed selected frames to LLM as if it read all frames. Migrate to maintained Cornerstone3D APIs with test fixtures. |
| `components/DicomViewer.tsx` | WW/WC, pan, zoom and measurement interaction patterns | References `cornerstoneWADOImageLoader` without an import in the inspected file, despite calling `fileManager.add`. Audit lifecycle, tools API, patient-coordinate measurements and version compatibility before reuse. |
| `components/Dicom3DViewer.tsx` | VTK volume rendering presets and multi-panel MPR layout ideas | Do not reuse voxel assembly blindly: verify `ImageOrientationPatient`, `ImagePositionPatient`, pixel spacing, frame of reference, duplicates, per-slice rescale and variable gaps. Oblique/tilted and irregular series need resampling, not naive stacking. |
| `lib/dicom-processor.ts` | Uses a DICOM parser and pixel intensity conversion | **Do not reuse its `anonymizeDicomBuffer` as de-identification**: it overwrites only a small tag list and, on error, returns the original buffer. Confidentiality must fail closed using DICOM PS3.15 profiles and formal verification of private tags, metadata and burned-in text. |

## What was actually adapted in v0.3

- `web/lib/dicom-series.ts`: technical metadata only; SOP UID and NumberOfFrames, regular slice spacing, full orientation orthonormality, Pixel Spacing, duplicates and gantry tilt/in-plane drift checks.
- `web/lib/dicom-lite.ts`: correct 8/16-bit stored-pixel alignment by High Bit; rejection of non-monochrome photometric formats, WC/WW=1 threshold, active-file memory cap on 8 GB Macs.
- `web/app/page.tsx`: independent statuses for **slice ordering** vs **future volume geometric suitability**. Neither flag means a 3D viewer or a validated reconstruction already exists.

These parsers are narrow, deliberately defensive research prototypes. They do not validate all DICOM modalities or SOP classes and should be replaced by appropriate standards-aware decoding and test datasets before any clinical deployment. Do not copy patient files or model/API secrets into the public repository.

## Next migration stage

1. Introduce Cornerstone3D via separately reviewed dependencies, with per-codec tests including JPEG2000, JPEG-LS and RLE; lazy-load viewer (no SSR) and always fail visibly on unsupported data.
2. Maintain full image matrices with their calibrated geometry; keep any PNG/JPEG previews separate from quantitative input.
3. Use NIfTI/SimpleITK/dcm2niix or MONAI in Python sidecar to verify affine transforms, gantry tilt, resampling, DICOM SEG and provenance.
4. Gate cloud LLM inference behind explicit user consent and verified de-identification, and never infer diagnoses from a small sample of frames alone.
