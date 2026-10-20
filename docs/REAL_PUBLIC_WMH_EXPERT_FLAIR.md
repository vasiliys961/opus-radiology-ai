# Real original public FLAIR MRI and expert WMH mask admission

Original publicly mirrored WMH Segmentation Challenge source:
https://huggingface.co/datasets/MedOtter/wmh-segmentation.
Source claims CC BY 4.0; verify the original challenge conditions and
the mirror's redistribution authorization before any clinical/commercial use.
Select exactly **Singapore/85**, publisher JSONL `test` split, with original
FLAIR NIfTI and expert binary WMH mask (not a network prediction).

`scripts/verify-public-wmh-expert-flair.py` downloads only the two exact
paths at an immutable Hugging Face dataset revision, verifies available LFS
digest, source NIfTI exact shape and native mm affine, 0/1 labels, and
nonzero expert-positive WMH voxels. Numeric-only hashes and voxel counts
are uploaded as CI artifacts, not MR pixels, patient demographics or masks.

This does NOT run the trained WMH network and is NOT evidence of a positive
prediction, sensitivity, MRI lesion-level Dice, stroke, multiple sclerosis
or Fazekas. The dataset says **official test**, but independence from
Jinghang Li's underlying model-training data has not been established.
It cannot be assumed to be held out from every trained model.
No patient data or cloud LLM transmission. Actual subsequent model
forward must use the original SHA-pinned publisher fold0 obtained and
verified in Action #39430002492, this original FLAIR SHA, and a secure
CPU/GPU worker with bounded image/mask storage. Any Dice from this one
case is descriptive research-only until disjoint-source validated.
