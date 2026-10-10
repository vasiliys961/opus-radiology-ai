# Full-volume handoff and result binding (v1.6.0)

This is a working local interchange path, not an installed inference service.
The hybrid-analysis button remains disabled. No inference, visual-model call,
clinical synthesis, anatomical completeness assessment or disease detection is
performed by preparing a package or importing a result.

## What the browser exports

In MPR select “Подготовить пакет серии”, then download both files separately:

- `opus-<requestId>_0000.nii`: the complete loaded scalar volume of **one selected
  series**, in Cornerstone voxel order. Single-file NIfTI-1, little endian float32,
  millimetres, scanner-space sform. LPS is converted to RAS including translation.
  No window/level, screenshot sampling, intensity normalization or resampling.
  Values already reflect the DICOM loader's decoding/scaling; providers must not
  apply the original DICOM rescale a second time. Float32 precision is explicit.
- `opus-<requestId>.request.json`: schema `opus-analysis-request/v1`, UUID v4
  request ID, SHA-256 of the exact NIfTI file, salted source-identity digest,
  dimensions/affine in LPS, modality, frame count and scope. Sequence and coverage
  remain `not-confirmed`; a model must independently establish supported input.

The source digest binds the request ID, Study/Series/FrameOfReference UID and
the entire sorted SOP Instance UID set. Duplicate/missing/inconsistent IDs fail
closed. Raw UIDs and filenames are not serialized. The salt is public and this
is not an anonymization guarantee. Pixel data can contain text or identifying
anatomy. Preparing/downloading locally does not send data to an external service.
Review the image, authorization and service before any later external transfer.

No temporary complete scalar array is requested from Cornerstone. One float32
NIfTI buffer is filled in chunks of 32768 voxels with cancellation/yields.
Export is bounded to 8388608 voxels (~32 MiB plus header); existing MPR input
limits still apply. SHA-256 and Blob creation can temporarily copy the buffer.
Download Blobs remain until replaced or the MPR runtime closes; URLs are revoked
on replacement/unmount. A cancelled or failed preparation preserves a prior
ready package. New preparations generate new IDs; old results are not accepted
against a new package. Returning from 2D requires preparing again.

## Package an existing real model output

Run inference in an isolated environment using an exact, audited checkpoint
compatible with modality, anatomy, sequence, input channels and acquisition.
Use the downloaded volume as its input, and return the mask on its physical
grid. The mask reader also supports axis permutation/reversal. Registration or
resampling onto unrelated coverage is not silently accepted.

Then package the **existing** mask. This helper uses Python's standard library;
it never loads/downloads a model and performs no inference:

```bash
python3 scripts/package-segmentation-result.py \
  --request /path/to/opus-request.request.json \
  --input /path/to/opus-volume_0000.nii \
  --mask /path/to/segmentation.nii.gz \
  --weights-artifact /path/to/exact-checkpoint-or-checkpoint-archive \
  --model-id provider/model-id --model-version exact-version --model-modality MR \
  --task supported-segmentation-task \
  --labels /path/to/labels.json \
  --limitation 'Acquisition-specific limitation from the validated model profile' \
  --output /path/to/result.json
```

`labels.json` is an array of `{ "id": 1, "name": "Name from the exact model dictionary" }`.
Use a checkpoint archive when the provider uses multiple checkpoints. The helper
checks the actual input SHA-256, hashes exact mask and weight-artifact bytes,
bounds/validates metadata and refuses to overwrite an existing output. It does
not verify that a claimed inference used that artifact or that a mask is correct.
Geometry and mask data are checked in the browser on import.

## Result contract and import

Choose “Импортировать результат модели” and select the mask **and** result JSON
together. The result has schema `opus-segmentation-result/v1` and fields:

| Field | Meaning |
| --- | --- |
| `requestId`, `sourceIdentitySha256`, `inputSha256` | Exact values from the active request |
| `maskSha256` | SHA-256 of the original selected mask file; gzip bytes count |
| `model.id`, `model.version`, `model.weightsSha256` | Declared provider/checkpoint provenance |
| `model.modality`, `model.task` | Declared supported modality and segmentation task |
| `labels` | Unique nonzero integer IDs (1–65535) and declared names |
| `limitations` | Explicit provider limitations, at most 20 bounded strings |

Unknown JSON fields are discarded; result JSON is limited to 64 KiB. Every
nonzero mask ID must appear in the dictionary. Modality, request, source/input
digests, exact mask digest and physical grid must match before replacing an
accepted mask. A failure retains the previous mask and its provenance. Plain
NIfTI import still works, clearly marked as geometry-only without package/model
binding. Labels and quantities are never disease diagnoses.

This unsigned contract prevents accidental file/job mixing and byte corruption.
It is not a model authentication protocol: a producer can copy/change the JSON.
Before automatic attachment or clinical synthesis, a future trusted inference
adapter must verify provider identity, model capability and actual execution.
Names/provenance remain declared, even when checksums pass.

## Verification and model selection status

Tests cover cancellation, resource bounds, oblique transforms, header precision,
scalar preservation, full UID-set binding, wrong jobs/bytes/modality/labels,
geometry mismatches and Python packaging. Chromium checks every voxel of the
exported synthetic phantom, both downloads, packaged-result import, wrong-request
rejection preserving the accepted result, MPR/3D controls and reset after 2D.
Synthetic metadata/weights/masks are explicitly test-only, never fake inference.
Safari/M1 performance and clinical reference-data validation remain outstanding.

Primary candidate documentation checked on 2026-10-10:

- [nnU-Net inference documentation](https://github.com/MIC-DKFZ/nnUNet/blob/master/documentation/how_to_use_nnunet.md): framework/checkpoint-specific pipeline, not a universal preinstalled knee model.
- [aagatti/nnunet_knee model card](https://huggingface.co/aagatti/nnunet_knee/raw/main/README.md): declares MRI knee/cascade input and MIT licensing, but contains inconsistent headline/evaluation metrics and a placeholder inference-code repository link. These claims do not validate the user's acquisition or establish an operational audited adapter. No checkpoint selected or installed.
- [MedSAM official repository](https://github.com/bowang-lab/MedSAM): prompt-guided workflow; it must not be presented as autonomous whole-study disease detection.

The actual knee sequence and a legal reference dataset/checkpoint validation are
still needed before enabling automatic segmentation for the user's MRI.
