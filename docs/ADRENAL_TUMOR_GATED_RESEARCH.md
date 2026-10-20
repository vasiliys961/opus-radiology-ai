# Original adrenal tumor CT — rights-gated research model executor

Source: https://huggingface.co/yunnaa/Adrenal-Tumor-nnUNet

**State:** Publisher describes real trained nnU-Net v2
`Dataset001_AdrenalTumor` with `nnUNetTrainer__nnUNetPlans__3d_fullres`,
five fold checkpoint_best.pth weights. Author ontology background=0,
adrenal gland=1, **adrenal tumor=2**; training cohort 373.
**The model repository is gated; downloading requires human acceptance of
its official conditions and the card license is `other`.** Its model
weight bytes/SHA-256 are NOT independently verified or installed in Opus.
No original model run or positive expert case is claimed. The nnU-Net Apache
license does NOT grant the separately gated model or CT patient rights.

The script `scripts/original-adrenal-tumor-gated-research.py` is an
**explicit local/external Linux worker adapter**, not an automatic download
or currently deployable detector. A human with rights must first obtain
official author weights, hash fold0, install all five folds under the official
nnUNet_results task/trainer structure and prepare a **correctly mapped**
author-protocol adrenal ROI: 128×192×192 voxels, 1mm isotropic and
soft-tissue-window original CT-derived image. Original full-CT to ROI transform
and later mask backprojection must be separately recorded; the model output
is **only within the pre-extracted ROI**, not a whole-abdomen localization.

The CLI requires `--roi`, `--roi-sha256`, `--nnunet-results`,
`--fold0-checkpoint-sha256`, `--output`,
`--human-accepted-official-gated-license` and (to infer) `--execute`.
It checks local weights, ROI geometry/source bytes, author original label
ontology, Linux/16GiB available-RAM guard, invokes genuine nnUNetv2_predict
on the 5 folds and records mask SHA and original class counts. Never run
on the 8GB Mac or a patient cloud worker without separate authorization.

**Pending:** verify actual rights and checkpoint SHA from official repository;
obtain rights-cleared positive expert-masked adrenal tumor CT with correct
preprocessing, execute true forward on isolated CPU/GPU, backproject to
original DICOM spatial coordinates, count TP/FP/FN/lesion recall on
independent cases. A zero tumor ROI mask cannot exclude an adrenal tumor.
The research numeric artifact must not contain patient identifiers or images.
