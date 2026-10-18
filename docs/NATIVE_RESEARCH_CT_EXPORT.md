# Native full CT export from live Opus DICOM to real pathology model

New research-only sidebar action "Экспорт исходной КТ для настоящих
детекторов MONAI / task315" directly uses the existing original-DICOM
full-volume geometry and decoded HU streaming path.

No complete decoded 3D NIfTI/Blob is allocated. DICOM frames are decoded
one by one; first pass hashes original NIfTI output and second pass writes
<=128 KiB blocks directly to a native browser-selected file. The exact
output byte count and SHA are independently checked before closing/committing
the local file. Failures/cancel abort the temporary output.

This action does NOT run MONAI, R231 or task315 and does NOT permit private
patient uploads. It writes only to the user's own disk. It is available only
for already-loaded whole selected CT chest series with verified original
geometry and bodyRegion CHEST for every frame. The user must explicitly attest
that the images are public, de-identified and licensed. This attestation is
NOT independent DICOM de-identification verification. Source full anatomical
coverage, completeness outside the loaded supplied series, and clinical
validity are all unknown.

A successfully saved original .nii can be moved by the user to a private
appropriately provisioned Linux research CPU to execute
services/imaging-ai/monai_bound_nodule.py, alongside the separately
user-downloaded 'opus-public-chest-monai-admission.json'. Model output is
returned into the existing /viewer tab MONAI - lung CT nodules where native
SHA and affine are independently checked. Output is a research candidate,
not a confirmed patient lesion.

This uses native File System Access showSaveFilePicker; browsers without
the API (such as Safari) display unsupported rather than accumulating
hundreds of MiB in RAM or silently uploading to a server. Do not relax the
8 GiB Mac safety policy. A fully streaming native Safari alternative and
direct authenticated in-app inference workflow are separate unfinished tasks.

No real patients / no external provider / no Next.js API upload, and no
synthetic image or mask is called a trained-model finding.
