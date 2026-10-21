# MRI spine: real two-stage original TotalSpineSeg disc, cord and canal model

**New anatomical segmentation outside existing vertebral CT masks.**
Original author: neuropoly/totalspineseg, source:
https://github.com/neuropoly/totalspineseg
Pinned source commit `4502d41bcb4a12e44f4be666411461ca81b02d89`,
package release `20260807`, original model release `r20260730`.

The author published **two REAL original pretrained model archives**:
1. Dataset101_TotalSpineSeg_step1_r20260730.zip (~1.05GB), official
   GitHub Release digest `781f81e8c94feccd3cef17d819ba5c293b506e9b1f2b106fc5e31b9dd85887b0`.
2. Dataset102_TotalSpineSeg_step2_r20260730.zip (~1.05GB), release
   SHA256 `494c640ab8cb25475bd0fc4338c0931d37079af9dd19403879335c3908c06b46`.

Published source code license **LGPL-3.0**. The exact rights of trained
weights and individual public research MRI studies require **separate
review**, so research-only. The source is designed to label **vertebrae,
intervertebral discs, spinal cord and spinal canal** across many MRI
sequences and to preserve original NIfTI geometry.

## Actual executable

`scripts/real-totalspineseg-disc-cord-mri-cpu.py` does:
- Source NIfTI original MRI input approval with exact SHA256, native 3D
  physical mm geometry and approved rights. Can accept explicitly verified
  T1/T2/STIR full-spine MRI, but protocol is operator-attested.
- Requires pinned TotalSpineSeg `20260807` on a separate Linux worker,
  minimum **12 GiB RSS research allowance**, never Mac M1/8GB/browser.
- Requires both full **official release ZIPs** and two separately installed
  fold-0 original nnU-Net pretrained model folders. Checks official archive
  whole-file SHA256, then *compares actual installed fold-0 checkpoint bytes
  directly with same entry extracted from the genuine pinned ZIP*, so merely
  placing genuine ZIP alongside unrelated fake model is insufficient.
- Calls the original CLI `totalspineseg input.nii.gz output_folder
  --device cpu --data-dir models --max-workers 1
  --max-workers-nnunet 1 --quiet` on explicitly isolated research CPU
  with process-tree RAM/time guard and no new cloud API/inference provider.
  Model weights must be **pre-installed** and network egress must be blocked
  externally to avoid vendor automatic download. Archive hash preflight fails
  closed if unavailable.
- Audits true original `step2_output` 3D labelmap 1/2, named lumbar disc
  classes 91–95/100 (T12–L1 through L5–S) against pinned publisher
  `tss_map.json`; exports per-disc original NIfTI voxel bounds,
  source-RAS centroids, mask volumes, counts of cord/canal anatomy voxels.
  Absent level is **not** a normal intervertebral disc.
- Outputs only numeric JSON. No research studies, model archives, masks,
  trained checkpoints, patient names or DICOM Study UIDs are uploaded to
  GitHub, Opus front end or cloud LLMs.

Example only on **already pre-provisioned isolated 16+ GiB CPU Linux host**:

    python3 scripts/real-totalspineseg-disc-cord-mri-cpu.py \
      --mri /authorized/original_spine_T2.nii.gz \
      --mri-sha256 <exact_original_MRI_SHA256> \
      --model-dir /isolated/author-pinned-TotalSpineSeg-data \
      --step1-zip /isolated/original/Dataset101_TotalSpineSeg_step1_r20260730.zip \
      --step2-zip /isolated/original/Dataset102_TotalSpineSeg_step2_r20260730.zip \
      --output-dir /isolated/new-spine-step2-output \
      --report /isolated/new-spine-numerical.json \
      --public-source-url https://actual-lawful-source \
      --public-source-license 'verified original license' \
      --approved-public-research --original-MRI-protocol-confirmed \
      --memory-gib 16 --timeout-sec 3600

## Medical boundaries

This is **not a herniated disc lesion detector**. It does not diagnose
disc degeneration, Modic changes, compression of cord/nerve roots, foraminal
stenosis, demyelinating spinal plaques, metastatic lesions or cancer.
The original publisher separately warns spinal cord CSA/cord compression
has not been adequately validated. True diagnostic tasks need new
pathology-specific segmentation or specialist review.

**Present Opus evidence:** exact author source and both signed GitHub
release asset SHA256 are available. The original two 1GB archives were
NOT downloaded, checkpoints NOT loaded, and no real trained MRI forward
or expert Dice was run in THIS PR. Green CI only verifies source-grid
NIfTI class ontology, lesion bounding boxes, and fail-closed author ZIP
provenance on deterministic fixtures. Next step: lawful public positive
spine MRI + original 2-stage pretrained CPU forward + independent
expert disc/canal masks, lesion-level validity. No patient workflow.


## Added bounded axial source-native research planimetry (2026-10-21)

The genuine pinned author step-2 mask now provides **optional** `nativeAxialCanalClass2Research`
per lumbar disc label (T12/L1–L5/S). For a NIfTI that explicitly declares
physical **millimetre** coordinates and whose in-plane normal is within
~18 degrees of superior/inferior RAS, it measures the square-millimetre
area of the publisher's **class-2 segmented spinal canal label** on
native slices containing **both** that disc's class and canal label.
When several exact native slices overlap, it returns the smallest
*observed segmented label-2 area*, matching source-voxel slice index,
source RAS centroid, and number of candidate matched disc slices.
It does **not** interpolate missing canal labels, infer neurological
symptoms, compute an unverified stenosis cut-off, or equate segmented
label-2 area with the entire true anatomical canal or thecal sac.
Sagittal/oblique series without an axial-like plane and series with
missing physical-mm units are **ineligible**, not negative.

**Evidence boundary:** anatomy-derived *research measurements* only;
not a newly pretrained pathology-specific disc, foraminal or spinal
stenosis detector. Original spine-model weights have **not** been newly
executed by this change, no genuine positive stenosis patient and
expert canal caliper have been evaluated. Inference stays opt-in on
a separate 12+ GiB Linux CPU host; Mac M1/8GiB and patient clouds remain
off. This closes a physician-useful source-localization/measurement
interface without claiming clinical sensitivity, specificity or diagnosis.
