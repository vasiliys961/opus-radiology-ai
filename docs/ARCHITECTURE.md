# Opus Radiology AI — technical roadmap

## Separation of concerns

- `web/`: Next.js visual interface, local browser DICOM preview, reports and human review.
- `services/imaging-ai/` (planned): isolated Python inference worker using FastAPI + PyTorch/MONAI. Model weights stored outside git and downloaded only on demand.
- `services/llm/` (planned): permissioned API bridge for Gemini/Claude/GPT/OpenAI-compatible aggregators; keys remain server-side.
- `storage/` (planned): private encrypted study storage. Never GitHub, never frontend `public`.

## Image integrity requirements

- Read StudyInstanceUID, SeriesInstanceUID, FrameOfReferenceUID, orientation/position, pixel spacing, Rescale Slope/Intercept, transfer syntax and number of frames.
- Keep raw voxel values for measurements, and windowed raster only as **view**, never source of quantitative AI inference.
- Sort series by dot(ImagePositionPatient, normal(ImageOrientationPatient)), not filename, index or Z-coordinate alone.
- Patient metadata must be deidentified with a standard profile; never remove fixed border portions of diagnostic images.
- Explicitly distinguish unsupported files from negative findings.

## Evidence schema (future)

Every finding must carry `study_uid`, `series_uid`, `frame_uid/index`, `model_id`, `model_version`, `anatomy`, `geometry`, `measurement`, `verification_status` and `processing_warnings`. Empty fields are `null`, never invented.

## Prototype reader limitations

`web/lib/dicom-lite.ts` is intentionally narrow and is **not a replacement for Cornerstone3D**. It supports only Part 10 single-frame uncompressed 8/16-bit monochrome little-endian images, for developer smoke tests. No DICOM spatial calibration or segmentation exists.
