# Carles et al. original CT lung tumor segmentation — research-only runner

## What was added
`scripts/carles-task998-ct-cpu.py` takes one explicitly supplied public,
permitted non-patient contrast/diagnostic CT NIfTI and an external original
`Task998_LungCTSegmentation` nnU-Net **v1** checkpoint. It calls the author's
documented `nnUNet_predict` program, with CPU visibility, a single fold,
one preprocessing worker, no test-time augmentation, and a finite timeout.

Author: https://github.com/MonCarFa/PET-CT-Lung-Segmentation-Models
Original **CT** weights: https://www.kaggle.com/models/dejankuhn/ct-lung-tumor-segmentation-model
The PET `Task999_LungPETSegmentation` model is explicitly NOT used.

The original publisher's pretrained model must be downloaded separately after
checking access and model/data licensing. Do not bundle weights in the Web app,
commit them to GitHub, or automatically download them on a Mac M1/8GB.

Expected nnU-Net v1 `RESULTS_FOLDER` structure:
```
<models>/nnUNet/3d_fullres/Task998_LungCTSegmentation/
    nnUNetTrainerV2__nnUNetPlansv2.1/
        plans.pkl
        fold_0/model_final_checkpoint.model
        fold_0/model_final_checkpoint.model.pkl
```

Use a separate CPU worker with measured free RAM. Run (only with
**approved public data**) after installing compatible official nnU-Net v1
and nibabel:
```bash
python scripts/carles-task998-ct-cpu.py \
  --ct /approved/public/ct.nii.gz --models /licensed/carles/nnUNet_trained_models \
  --output /worker/output --report /worker/metrics.json --public-research --preflight
```
Remove `--preflight` for actual model inference. Use `--expert /approved/expert-tumor-mask.nii.gz`
when available. The result is a native-grid `case.nii.gz` that can be imported
using the existing local NIfTI mask route and audited against original image
geometry. The numeric report contains source and weights SHA-256; it does not
contain original CT files, DICOM IDs, raw pixels, or patient metadata.

## Evidence boundary
The actual original Carles CT weights have **not** yet been downloaded or
executed by this branch. CI verifies only the runner contract, not a model
forward. Even a real nnU-Net result without a physician-annotated tumor mask
provides **no sensitivity, Dice, or negative screening conclusion**.
With an expert mask, a voxel Dice is a single-case research value and is not
automatically independent validation. Mask label 1 is a declared CT tumor
candidate and must be checked against original model dataset labels.

CPU resource consumption is not yet accepted for the user Mac; run only on an
isolated machine with enforced external RAM limits. Original checkpoint and
research data licensing must be independently reviewed. The model is not
installed in production. Patient cloud egress stays OFF.

## Other intrathoracic models
The original Bouget UNet-SW32 completed an authentic CPU forward on one public
LyNoS Pat3 case in run
https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39377534558
with TP 244, FP 2691, FN 9181, **Dice 0.03948**. This is unsatisfactory
on that case and not independent clinical validation; Bouget stays research-only.
