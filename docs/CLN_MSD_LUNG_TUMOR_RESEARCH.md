# Original CLN-Segmenter MSD Task06 lung tumor (single fold) — research only

## Original model / use limit
Original public source: https://huggingface.co/Lab-Rasool/CLN-Segmenter-MSD-fold0
Publisher revision prefix: `150ec31`, task `Dataset502_MSDLung`, nnU-Net v2
`nnUNetTrainer__nnUNetPlans__3d_fullres`, fold 0, checkpoint
`checkpoint_best.pth` (~247 MB). Publisher declares CC BY-SA 4.0.
Reported mean validation Dice 0.7161 on 13 fold-0 CT cases is **the author's
in-distribution result, NOT an independent Opus accuracy measurement**.

## Real code
`scripts/cln-msd-original-ct-cpu.py` has two distinct tasks:
- `--mode provision`: fetch *actual author files* from immutable revision;
  validate the complete Git revision, original LFS weight SHA256, and author's
  CT label 1 and 3d_fullres configuration, copy the checkpoint to the
  documented nnU-Net v2 model directory. No inference, CT or patient files.
- `--mode infer`: opt-in on an **isolated CPU host with external RAM cgroup**;
  requires explicit approved public CT NIfTI, source SHA256 and independently
  recorded model SHA256. Calls the real `nnUNetv2_predict -device cpu` program,
  monitors aggregate process-tree RSS, single preprocessing/export workers,
  disable TTA, no GPU; validates native CT/mask shape + affine, returns candidate
  volume, source voxel bounds, centroid, optional expert-mask TP/FP/FN/Dice.
  These are research measurements only; multiple lesions are not separated.

Run provision with `python3 scripts/cln-msd-original-ct-cpu.py
--mode provision --model-dir /isolated/models --report /isolated/weights.json`.

Run inference (with nnunetv2 2.7.0, nibabel, psutil and a **separate**
appropriately provisioned CPU machine):
```bash
python3 scripts/cln-msd-original-ct-cpu.py --mode infer \
  --model-dir /isolated/models --ct /approved/source.nii.gz \
  --source-sha256 <verified-public-CT-hash> \
  --checkpoint-sha256 <from-successful-provision> \
  --approved-public-source --output /isolated/output \
  --report /isolated/report.json --memory-gib 6 --timeout-sec 1800
```
Add `--expert /approved/expert-mask.nii.gz` only when original trusted
human annotations exist and the source is appropriately licensed.

## Hard boundaries
* The first GitHub CI job tests only code contracts; **after green PR merge**
  a separate public-weight job downloads/hashes the genuine checkpoint and
  exports only hashes/model metadata, not 247 MB weights or patient scans.
* Provision is not inference. Inference is not diagnostic validation. No
  empty mask means "normal"; no new patient-mode or cloud mode enabled.
* The 8 GB Mac is not a benchmark host for this full 3D nnU-Net model.
  A pinned CPU worker with bounded RAM/time and a permitted expert-positive
  CT is necessary for true sensitivity/Dice measurements.
* The native NIfTI affine coordinates are not automatically DICOM LPS/SOP.

## Current next acceptance
(1) Genuine checkpoint SHA verified on hosted CPU;
(2) named publicly redistributable expert-positive CT with source SHA;
(3) real trained forward with original volume geometry;
(4) voxel TP/FP/FN, independent data overlap audit and component-level recall.
