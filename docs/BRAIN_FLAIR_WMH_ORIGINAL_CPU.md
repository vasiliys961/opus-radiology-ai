# Brain FLAIR WMH pretrained original model CPU research

This is a **real executable pretrained model bridge**, not a trained WMH result
or an automatic demyelination-vs-vascular distinction.

Original research model: Jinghang Li et al. wmh_seg 1.6.0 at upstream commit
`a5ad55c6dec7cb2d4bd7b419a3e7d0c14e72aaee`, original source:
https://github.com/jinghangli98/wmh_seg
Original pretrained nnU-Net v2 in-vivo fivefold model described by author,
including FLAIR, T1 and other contrasts. The present Opus wrapper strictly
requires ORIGINAL 3D FLAIR MRI with source SHA and exactly **fold 0** of
upstream's externally preinstalled pretrained checkpoint; external installed
source must be inspected and model SHA independently recorded by operator.
This is not the 5-fold ensemble, so author 5-fold metrics cannot be reused.
Published model folders are described by the author as
`dataset.json`, `plans.json`, `fold_0/checkpoint_final.pth`.
The official repo publishes **no machine-readable license in GitHub metadata**:
until code/weights legal rights are established, research-only and no default
patient/commercial distribution. Not the separate GPL-3 Hongwei model.

Install pinned dependency stack and true checkpoint on a separate legally
approved Linux CPU worker, explicitly outside the browser and 8GB Mac.
Use an external **network-disabled** host/container; wrapper sets
`HF_HUB_OFFLINE=1` and supplies `WMH_SEG_INVIVO_DIR` so missing checkpoints
fail rather than silently downloading 1.2 GB during inference.

    python3 scripts/real-brain-flair-wmh-cpu.py \
      --flair /licensed/original_FLair.nii.gz \
      --flair-sha256 <exact_FLAIR_SHA256> \
      --model-dir /secure/original-publisher-invivo \
      --checkpoint-sha256 <exact_original_fold0_checkpoint_SHA256> \
      --mask-out /isolated/new_wmh_mask.nii.gz \
      --report /isolated/new_wmh_numeric.json \
      --public-source-url https://actual-source-with-license \
      --public-source-license 'verified original source rights' \
      --approved-public-research --flair-protocol-confirmed

Requires original source-verified FLAIR and original pretrained model weights.
The runner attempts actual `wmh_seg -i ... -o ... --invivo --folds 0`
on **CPU**, 6-GiB process-tree RSS safety cap, 2400-second timeout. Missing
original pretrained weights, non-binary output, wrong physical MRI grid,
unsupported input and time/RAM limits fail closed. No patient egress.
Output: true source and weights SHA, source native RAS mm lesion centroids,
per-component volumes and 3D voxel boxes, candidate count; zero candidates
DO NOT establish a normal study.

White-matter hyperintensity segmentation **does NOT diagnose multiple
sclerosis**, cerebral small vessel ischemic disease or vasculitis. FLAIR
hyperintensity has multiple possible etiologies including demyelination,
gliosis, vascular injury, inflammatory and artefactual lesions.
No Fazekas score without reviewed lesion distribution and a separate
clinical grading study. No independent MRI ground-truth Dice or clinical
outcome demonstrated by this code/CI. PR CI runs synthetic source-grid
numerical tests only. The next milestone is one rights-cleared original
FLAIR+independent expert WMH lesion map and original fold0 real forward,
followed by an independent negative/positive cohort.
