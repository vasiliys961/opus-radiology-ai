# ICH alternative — genuine pretrained ianpan detector (research only)

Executable adapter: `scripts/run-ianpan-ich-research.py`, added independently of SAMIHS.
No actual positive CT inference has been verified for this adapter yet.

## Original published pretrained assets

- Model: https://huggingface.co/ianpan/ct-head-hemorrhage-detection (MIT source/model card; check every runtime dependency separately).
- Model release revision: `e6d89c2`; real vendor `inference.py` and all seven original Safetensors are checked against published [SHA-256 and lengths](https://huggingface.co/ianpan/ct-head-hemorrhage-detection/blob/main/checksums.json).
- Vendor source: https://huggingface.co/ianpan/ct-head-hemorrhage-detection/blob/e6d89c2/inference.py .
- Vendor model implementation dependency: `git+https://github.com/i-pan/ct-head-hemorrhage-detection.git@914c57d`; install in a disposable, isolated, operator-owned research environment, using the official pinned `requirements.txt` at the model revision. Audit this code and license before installation. The runtime runs the SHA-verified vendor implementation unmodified.
- Output: six uncalibrated probability scores per CT series and per slice, and candidate model-window heatmap regions (0.5 research thresholds). Six channels: epidural, intraparenchymal, intraventricular, subarachnoid, subdural, any. **No CT source registration, DICOM SOP mapping, volumes, Dice or verified lesions.**
- The publisher's test AUROC/Dice are **publisher-reported only**, not Opus external validation; the BHSD segmentation dataset contains leakage caveats documented by the author. A returned heatmap must not be used to declare hematoma volume.

## Entry criteria

Only explicitly approved PUBLIC, noncontrast CT head NIfTI for which the data rights, deidentification, full acquisition and actual *calibrated HU* from CT DICOM rescale have been reviewed. The original Zenodo SAH processed slab is **not approved** for this model because HU/native DICOM are unverified. The program deliberately refuses without a SHA-256-bound JSON operator-evidence manifest:

```json
{
  "schema": "opus-public-head-ct-hu-evidence/v1",
  "modality": "CT",
  "anatomy": "HEAD",
  "contrast": "NONCONTRAST",
  "deidentifiedPublicDataset": true,
  "publicDataRightsReviewed": true,
  "sourceUnits": "HU_FROM_VERIFIED_DICOM_RESCALE",
  "sourceFullStudy": true,
  "sourceNiftiSha256": "<actual lowercase hex sha256 from your approved source>",
  "consent": "PUBLIC-HEAD-NCCT-RESEARCH-OK"
}
```

**Never fabricate evidence flags.** A manifest is an operator attestation only, NOT independent verification of calibration or patient anonymity; inspect actual source DICOM metadata, privacy and conversion provenance first. Supported NIfTI 3D format (512 x 512 x <=64 CT slices), <=128MiB input compressed/uncompressed, axis-aligned orientation; oblique orientation is rejected instead of silently resampling. Worker needs at least 10GiB free RAM. Run on separately provisioned CPU/GPU environment, not Mac M1/8 GiB. A model has yet to pass real end-to-end CT testing.

## Manual run on authorized isolated worker

Install the vendor's pinned research requirements in a sandbox (the runner imports torch, nibabel, numpy, psutil, huggingface_hub and the author's pinned `skp` package). With a lawful HU NIfTI and true manifest:

```bash
python scripts/run-ianpan-ich-research.py \
  --source /approved-public-source/head-ct-hu.nii.gz \
  --manifest /approved-public-source/hu-evidence.json \
  --model-dir /private-research-checkpoints/ianpan \
  --output /private-research-output/head-ich-candidates.json \
  --device cpu --download-pretrained
```

Use `--device cuda` only on an intentionally provisioned GPU; no automatic fallback. Once assets are downloaded and verified, omit `--download-pretrained`. Allowlisted network downloads must be restricted by your infrastructure; merely setting HF offline flags is insufficient. Never commit or upload CT, patient identifiers, checkpoints, raw masks, or local private paths. No clinical or patient-mode activation.

## Acceptance needed for a diagnostic milestone

First an actual successfully executed real pretrained ICH run on legal public full NCCT with proven HU plus separate external expert reference; then independently validate source reorientation and heatmap-to-source alignment before claiming localized lesion, TP/FN, spatial Dice or sensitivity. Do not use a model-classification score to substitute for radiologist confirmation or an independently measured lesion. Include negatives in the next evaluation and report study/lesion-level outcomes distinctly.

## Research source-voxel localization (not yet clinical validation)

With a verified genuine model invocation, the runner now derives a bounded
`sourceVoxelProjection` for each non-empty 512×512 candidate heatmap region.
It inverts the *published pinned vendor's* NIfTI loading path: nearest-axis
NIfTI → LPS reorientation, voxel order `(z,y,x)`, then center-padding/cropping
the HU slice to 512×512. Each projected proposal includes:
- native source NIfTI voxel `[xMin,yMin,zMin,xMax,yMax,zMax]`;
- world RAS bounding coordinates (mm) from the original NIfTI affine;
- whether the model region crossed the original CT field of view;
- explicit `independentlyClinicallyVerified:false` and `expertMaskCompared:false`.

The source NIfTI SHA-256 still binds the CT. Areas located only in model
zero-padding correctly receive **null source projection**, not an invented
lesion. Empty model heatmaps remain empty. The original report retains
`modelInputHeatmapsAreSourceAligned:false`: the full heatmap is not saved in
source pixel space and no imported patient DICOM SOP is registered. This
research inverse geometry is **not** a radiologist-approved interpretation or
independent model/source accuracy confirmation.

The physician-facing JSON importer can now display source NIfTI voxel and RAS
bounds for later comparison with independent expert markup, without uploading
pixels. Synthetic RAS/LPS and swapped-axis test cases validate the inverse
transform. There is still **no genuine public CT inference result** for this
model and no independently confirmed ICH localization or sensitivity.
