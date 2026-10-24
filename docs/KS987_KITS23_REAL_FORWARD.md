# KS987 kidney cancer: genuine positive KiTS23 full forward + expert scoring

This isolated executable connects existing publisher-original nnU-Net **Dataset102_Kidney** fold-0 inference and the already admitted expert-positive KiTS23 case_00021 native-grid scorer. It DOES NOT itself claim successful inference until the original forward and scoring complete. No fabricated probabilities, retrospective score from an unrelated mask, or clinical diagnosis.

Requirements: isolated Linux worker with >=64 GiB **available** memory, original audited custom nnUNetTrainerWandb2000 and nnU-Net v2 installed, original checkpoint with pinned SHA256, legally permitted original KiTS23 case_00021 CT/expert NIfTI, exact CT/expert digests in the scorer. The public source may be part of model training; this is NOT independent clinical validation.

Example on authorized isolated worker:

```bash
python scripts/run-ks987-kits23-real-forward.py \
  --ct /research/input/case_00021_0000.nii.gz \
  --expert /research/reference/segmentation.nii.gz \
  --nnunet-results /research/KS987/nnUNet_results \
  --output /research/new-renal-model-run \
  --device cuda --execute-original-public-forward
```

The script checks admitted original image, expert segmentation and checkpoint hashes **before** any model launch; calls genuine original nnUNetv2_predict through the existing guarded executor; requires a new native-grid prediction; and **only after completed original forward** scores expert kidney tumor class 2 against publisher tumor class 1. Reports numeric TP/FP/FN/Dice, matched tumor components and original-source SHA. Original pixels, predictions, expert masks and weights stay on the isolated worker. No clinical use, no claim of independent case.

Do not attempt on the owner's Mac M1 8 GB or standard GitHub Actions runner. No actual inference is initiated by PR CI. This change wires existing working research executors; the real forward remains pending appropriate public-data provisioning and >=64GiB memory.
