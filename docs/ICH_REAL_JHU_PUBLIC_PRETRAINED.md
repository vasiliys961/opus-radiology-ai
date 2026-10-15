# Genuine pretrained ICH on ONE fully public Johns Hopkins head CT

Purpose: actually execute the SHA-pinned `ianpan/ct-head-hemorrhage-detection`
on original *public* non-contrast head CT, not normalized SAMIHS/Zenodo SAH
inputs or synthetic benchmark data. The workflow automatically runs **once
on main** after this PR is merged. No user browser, account, credentials,
Mac GPU, patient files or manual button presses are involved.

**Open original source:** Hanley, Mould, Ullman & Muschelli, *Head CT Scans
associated with 'Validated automatic brain extraction of head CT images'*,
Johns Hopkins Research Data Repository, DOI
[10.7281/T1/CZDPSX](https://doi.org/10.7281/T1/CZDPSX), file
[01.tar.xz](https://doi.org/10.7281/T1/CZDPSX/TPLNQI).
The public, original file has publisher MD5
`a1e57f5cb684fc238d32a019bec456ad`, published in 2019, and an
identified Dataverse API download
`https://archive.data.jhu.edu/api/access/datafile/1311?gbrecs=true`.
This is NOT the restricted RSNA challenge, CQ500 EULA, or current PhysioNet
1.3.1 restricted dataset. No redistribution of source pixels.

Bounded source acquisition: download <=16MiB with full MD5 match,
read a single named public original NIfTI member out of the tar archive
without extracting arbitrary files, validate dimensions/orientation/
source voxel intensities; transcribe *all* slices preserving intensity
and affine, record exact SHA of original gzip plus resulting source NIfTI.
Reject normalized (0–1) images and malformed, oversized, oblique,
inconsistent, or out-of-range images. Do not crop or pad a source to
manufacture model agreement.

**Material limitation: original source DICOM rescale attributes were not
independently available.** A DICOM-derived NIfTI with a plausible negative
air HU range and original CT geometry remains *publisher-based HU plausibility*,
not independently reverified DICOM RescaleSlope/Intercept. It is deliberately
tagged
`PUBLISHED_DICOM_DERIVED_CT_HU_LIKE_NOT_DICOM_RESCALE_INDEPENDENTLY_VERIFIED`.
The pretrained research model may be executed on such a gated source, but
the output is never allowed to claim independent HU proof or a validated
medical diagnosis. Failure to pass the HU-like original source gate ends the
workflow before any neural network download.

Original vendor pretrained ICH assets:
[ianpan/ct-head-hemorrhage-detection](https://huggingface.co/ianpan/ct-head-hemorrhage-detection)
at pinned revision `e6d89c2`. The research runtime validates each
published individual Safetensors and `inference.py` SHA-256.
Original published source Python package and dependencies are installed
from the pinned upstream `098b7ff` commit
(`skp`, torchvision, torch, timm, opencv etc). The original upstream
`predict_hu_volume(...,batch_size=1,return_segmentation=True)` runs the
complete public scan: subtype and 'any' slice and series classifications
plus model-localization maps. Explicit resource preflights and full
CT source limits; no automatic partial-slice substitution.

**Not a positive-lesion validation.** This specific JHU archive has
brain-extraction masks, *not automatically usable independent voxel-level
hemorrhage contours*. We will not treat brain-only masks as hematoma masks,
infer Dice/volume/clinical sensitivity from model probabilities, or imply
the original study definitely contains hemorrhage without independent
clinical reference. A second external expert hemorrhage reference is
still required for demonstrated true-positive localization.

Execution: `.github/workflows/ich-ianpan-real-jhu-public.yml`. On an
approved GitHub-hosted CPU, it outputs only a bounded JSON report of model
candidate locations/uncalibrated scores and pinned source/checkpoint
hashes to Actions artifacts. No images, headers with patient IDs, or
checkpoint bytes are uploaded. A failed resource, download, source,
or model check is reported as **failure**, not an ICH negative result.
For research only. Not for patient diagnosis or triage.
