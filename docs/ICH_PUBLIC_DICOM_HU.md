# Public original DICOM → calibrated HU NIfTI (ICH)

**Purpose:** avoid repeating the SAMIHS mismatch caused by unverified CT intensity
units. The specialized pretrained ianpan ICH model requires HU and the original
axial NCCT acquisition, not a windowed, skull-stripped or normalized SAH slab.

The bounded converter `scripts/prepare-ich-public-dicom-hu.py` verifies SHA-256
for EVERY source single-frame DICOM, exact original study and series identity,
source geometry (ImageOrientationPatient / ImagePositionPatient / PixelSpacing),
finite required DICOM RescaleSlope and RescaleIntercept and observed HU pixel
values. It refuses localizers, extra unreviewed files, repeated SOPs, mixed
series, duplicate/irregular slice spacing, nonaxial orientation and
unapproved provenance. It emits a spatially positioned original-resolution
float32 NIfTI with RAS affine and a SHA-256-bound HU/provenance research manifest
that the existing `scripts/run-ianpan-ich-research.py` can consume.

The converter DOES NOT download, analyze or deidentify patient CT. It processes
**only separately reviewed permitted public NCCT** in an isolated research
environment, without sending pixels, filenames or patient tags to an API.

## Required exact-source authorization

Have an authorized operator review rights, source deidentification, pixel burn-in
and true noncontrast axial acquisition. Record a private JSON (do not commit it):

```json
{
  "schema": "opus-public-dicom-head-ncct-authorization/v1",
  "publicDataRightsReviewed": true,
  "deidentifiedPublicDataset": true,
  "modality": "CT",
  "anatomy": "HEAD",
  "contrast": "NONCONTRAST",
  "sourceFullStudy": true,
  "consent": "PUBLIC-HEAD-NCCT-RESEARCH-OK",
  "dicomFiles": [
    {"name": "slice_001.dcm", "sha256": "64 lowercase SHA256 characters"},
    {"name": "slice_002.dcm", "sha256": "64 lowercase SHA256 characters"}
  ]
}
```

Every 8–64 publicly authorized real `.dcm` file must have an accurate,
individually confirmed SHA-256. The two-row fragment above is illustrative and
**not executable**. No fabricated proof or placeholder checksums.

## Separate consented public execution

```bash
python -m pip install "numpy==2.2.6" "nibabel==5.3.2" "pydicom==3.0.1"

python scripts/prepare-ich-public-dicom-hu.py \
  --dicom-dir /approved-public-ct/dicom \
  --public-authorization /approved-public-ct/authorization.json \
  --output-nii /isolated-research/output/hu-head.nii \
  --output-manifest /isolated-research/output/hu-head-evidence.json
```

The resulting HU `.nii` plus exact research manifest are valid input types for
the existing pinned ianpan runner. The converter **does not** run the model, and
the presence of a manifest cannot prove that authorization and pixel privacy
were truly reviewed. Real model results and independent expert labels remain
required before any clinical sensitivity, Dice or true-positive claim.

Scope limit: original axial CT, single-frame monochrome, 128–512 matrix, 8–64
slices, 128 MiB aggregate, regular 0.1–12 mm slice spacing; no oblique or tilt,
no unsupported compressed pixel codecs, no interpolation, no broad patient mode.
The converter preserves source spatial axes without claiming DICOM SOP linkage
for the ianpan network's cropped 512×512 heatmaps.

The default CI creates only **synthetic nonpatient DICOM fixtures** and verifies
original HU rescaling, image geometry, SHA-binding, and refusal of misaligned
source studies. No GPU or checkpoint is installed or executed by CI.
