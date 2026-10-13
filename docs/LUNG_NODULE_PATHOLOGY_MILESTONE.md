# Diagnostic milestone 1 — MONAI lung nodule public examples (asset admission)

**This is a reproducible clinical-target reference + real model-weight
integrity test, NOT yet a pathology prediction.**

Official MONAI bundle [lung_nodule_ct_detection 0.6.9](https://huggingface.co/MONAI/lung_nodule_ct_detection/tree/7226a40a4c3713f7d5469559b7f2fc296fd54825):
3D RetinaNet trained on LUNA16. Official published PyTorch
\`models/model.pt\` is **83.7 MB**, SHA-256
\`b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01\`.
Repository has Apache-2.0 LICENSE. Using \`torch.load\` on a PyTorch pickle
is **not permitted** by this asset-check workflow; a separate pinned,
network-isolated, permissioned worker must execute trained inference.
The model's published fold-0 mAP/mAR are NOT independently established Opus
clinical performance; the bundle's training-data overlap is unresolved.

Ready example:
- [Official LUNA16 challenge](https://luna16.grand-challenge.org/) contains
  radiologist-consensus pulmonary nodule centroid/diameter references.
- Small public [annotations.csv mirror](https://huggingface.co/datasets/MedOtter/LUNA16/blob/main/annotations.csv)
  (CC BY 4.0 as declared by the mirror, pinned dataset revision
  \`fb396557c4e23feaf9c432cea7fc8426214648fb\`).
  This is published de-identified **annotation metadata only**; it is
  NOT a CT study or predicted boxes.
- All 1,186 ground-truth reference nodules are ingested, sorted by
  series, and checked for finite LPS coordinates and positive diameter
  in \`scripts/check-luna16-nodule-reference.py\`.
- The lightweight
  \`.github/workflows/pathology-nodule-reference.yml\`
  downloads **only 137 kB annotation CSV plus published 83.7 MB checkpoint**,
  verifies the actual checkpoint file SHA-256 (without loading it),
  prints aggregate counts, diameter groups and hashed-id
  example coordinates, and deletes both assets. No upload artifacts,
  no external provider, no Mac inference, no invented candidate scores.

The JSON output explicitly sets:
\`genuineModelInferencePerformed:false\`,
\`modelCandidates:null\`, \`detectionSensitivity:null\`, \`froc:null\`,
\`specificity:null\`, and \`readyForClinicalUse:false\`.
**A reference nodule is not a model-predicted nodule.**
Counts of positive scans from annotations cannot measure specificity
or the FP-per-scan denominator (which needs all negative scans).

Next: obtain one **lawfully distributed source full chest CT** paired to an
independent reference, with source SHA, original voxel geometry and
train/val/test fold provenance. Pin reproducible MONAI bundle env to its
version; run full native-volume model inference on an explicitly approved
worker meeting resource requirements. Return raw predicted boxes/scores
with source volume hash and LPS-mm coordinates. Only then benchmark the
predictions against held-out data without patient overlap and show candidates
on original MPR slices. Do not claim clinical readiness until independent
clinical evaluation and appropriate medical-device authorizations.
