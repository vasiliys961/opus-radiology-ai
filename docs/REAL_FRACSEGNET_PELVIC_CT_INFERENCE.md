# Real pretrained FracSegNet — pelvic bone fragment CT research executor

A distinct **pelvic fracture / bone fragment** pathology task, not the
TotalSegmentator bone anatomical masks.

Original publisher: https://github.com/YzzLiu/FracSegNet
Original code: MIT.
Original author's **pretrained fracture** model:
https://drive.google.com/file/d/1tBnXpmSlbJBx_EloS1evumVVMILYRl6Q/view

`scripts/real-fracsegnet-v1-pelvic-fracture-gpu.py` invokes the publisher's
patched nnU-Net v1.7 `nnUNet_predict` on a PRE-EXTRACTED pelvic bone ROI.
It requires an externally installed and independently SHA-256 recorded
large trained model checkpoint plus its associated `.model.pkl`, the exact
author nnU-Net task and an approved public bone-ROI CT bound by SHA-256.

The source must be a 3D NIfTI volume in native mm geometry.
On an isolated NVIDIA GPU with **at least 10 GiB VRAM**, it executes actual
publisher fracture-fragment inference, validates the prediction against the
source affine, and returns local fragment-candidate voxel boxes, centroids,
volumes, mask/model/source SHA and explicit uncertainty for physician review.
No patient scans or masks are uploaded to GitHub.

This is only the SECOND fracture segmentation stage. The author requires
preceding pelvic anatomical segmentation and bone-region extraction, neither
of which is silently replaced by a manual ROI selection. A single ROI does
not represent entire-pelvis clinical coverage. Nonzero fragments are NOT a
fracture diagnosis and empty output does NOT exclude a fracture.

Before running, install original nnU-Net v1.7 and vendor FracSegNet patched
training/inference files following the author's code/Readme.md, unpack the
original published checkpoint into an nnU-Net compatible RESULTS_FOLDER,
record its SHA-256, and supply correct `--task`, `--checkpoint`,
`--checkpoint-sha256`, `--source-sha256` and the two explicit research
flags. Do not run on Mac M1 8 GB, generic web hosting or a CPU-only worker.

No original FracSegNet trained inference was executed by THIS PR. Only a
real runnable external GPU model executor and fail-closed provenance checks
are added. Actual vendor checkpoint access/licence and a positive PENGWIN
case must be verified separately. The code license (MIT) does not prove
commercial permission for the separately hosted weights and dataset.

Existing source-native pelvic fragment review and expert Dice bridge:
`scripts/real-pelvic-fracsegnet-fragment-evidence.py`.
