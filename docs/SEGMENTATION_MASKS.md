# Precomputed segmentation masks (v1.5.0)

This milestone imports real precomputed label arrays; it does not run a neural
network, detect disease, infer anatomy names, or generate 3D segmentation surfaces.
The mask belongs to the currently open MPR runtime and is released when that
runtime/series closes. Returning from 2D requires importing it again.

## Supported format and limits

- Single-file NIfTI-1 `.nii` or gzip `.nii.gz`, little or big endian.
- 3D scalar labels, or higher dimensions whose extra axes all equal one.
- uint8, int8, uint16, int16, uint32, int32, or float32 storing exact integer IDs.
  Background is zero; labels must be in 0–65535. Probabilities, intensity scaling,
  time series, vector masks, Analyze pairs and NIfTI-2 are rejected.
- At most 32 MiB per input and expanded file, 8,388,608 voxels, 256 nonzero labels.
  Gzip expansion is streamed and cancelled when the expanded byte cap is exceeded.
  Parsed data is normalized to one uint16 label buffer (at most 16 MiB).
- Spatial units must be declared. Metres and microns are converted to millimetres.
  sform/qform codes 1 or 2 are supported. Unknown or template-space transforms,
  singular matrices, malformed quaternions and inconsistent forms are rejected.

## Coordinate integrity

NIfTI RAS coordinates are converted to DICOM LPS, including translations. Source
geometry comes from the loaded Cornerstone imageData index-to-world mapping,
not from assumed anatomical axis names or filenames. Import permits only the
same physical voxel grid, allowing axis permutation/reversal. All eight corners
must agree within 0.05 mm. Mismatched resolution, position, orientation, dimensions
or coverage is rejected. There is no implicit registration or resampling.

This tolerance is an engineering alignment test, not a statement of clinical
accuracy. NIfTI alone does not establish Study/Series/FrameOfReference identity;
two unrelated studies can share a grid. The user must verify the mask's provenance
and inspect the overlay. A future inference adapter must bind outputs to source
study/series identifiers and model provenance before automatic attachment.

## Display and quantities

Discrete IDs are sampled with nearest neighbour on each actual orthographic
viewport plane. Display work is bounded to 384 pixels on the longer overlay edge,
with a coalesced animation-frame redraw when slices or layout change. The source
mask retains full resolution. CSS scaling preserves discrete edges; small labels
may be missed in this reduced display raster, so it is not a measurement view.

The user can choose an ID, show all IDs, hide the overlay, adjust opacity or remove
the mask. IDs remain generic until a verified model label dictionary is provided.
The display palette repeats after eight IDs; use the ID selector to disambiguate.
Label volume equals voxel count times the absolute affine determinant / 1000
(millilitres). This describes the mask's extent, not model accuracy or diagnosis.
An empty mask is reported as empty, never as absence of pathology.

## Reproducible synthetic geometry check on Mac

From the repository root:

```bash
node scripts/generate-segmentation-phantom.mjs
```

This writes only synthetic fixture data under the ignored
`test-data/generated-segmentation-phantom/` folder. It creates 32 uncompressed MR
DICOM slices, a correct mask and a mask shifted by 1 mm. There is no patient data
and the spheres are not anatomical structures.

1. Load the `dicom` subfolder as a separate study; select MPR.
2. In “Сегментация · готовая маска”, import `synthetic-mask.nii`.
3. Check all three planes and switch IDs: label 1 has 8130 voxels / 16.260 ml;
   label 2 has 470 voxels / 0.940 ml. Toggle visibility and opacity, scroll slices.
4. Import `synthetic-mask-shifted.nii`: it must be rejected and the previous
   accepted mask must stay attached.
5. Switch back to 2D and confirm normal viewing; a closed MPR runtime must release
   the mask. The phantom does not validate segmentation models or clinical use.

The generated fixture round-trip is also covered by `npm test`, using the actual
DICOM header, pixel and mask readers. Safari/M1 and clinical reference-data testing
remain separate from successful unit tests and a production build.

Primary format reference:
https://github.com/NIFTI-Imaging/nifti_clib/blob/master/niftilib/nifti1.h
