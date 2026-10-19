# Spine — osteolytic lesions of multiple myeloma on dual-energy CT

New pathology localization in Opus. This is **not** vertebral anatomy,
and **not** a general ordinary CT detector.

## Published genuine original model and data

- Original author trained nnU-Net model archive (3.7 GB): [Zenodo 18598645](https://zenodo.org/records/18598645), archive MD5: `02f72a4c4bf8c34790b36400db7cc6d1`.
  Publisher repository: [MISAG-BUT/Spinal-Multiple-Myeloma-SEG](https://github.com/MISAG-BUT/Spinal-Multiple-Myeloma-SEG), immutable \`v1.0.2\` commit \`502978885a765b6aa5db9da345bf2c3855bc73f6\`.
- **Two different trained tasks are required:** anatomical Dataset802 spine segmentation on conventional CT, **then** Dataset710 myeloma lesion segmentation on 40-keV virtual monoenergetic CT using the cropped spine.
  Model input includes aligned conventional CT **and VMI 40 keV**, not arbitrary chest/spine CT.
- Public original reference: [TCIA Spinal-Multiple-Myeloma-SEG](https://www.cancerimagingarchive.net/collection/spinal-multiple-myeloma-seg/): 67 deidentified research subjects, 72 examinations, original DICOM series and expert osteolytic masks under **CC BY 4.0**. The model may have used these cases during training; we **do not claim independent holdout**.
- Code license Apache-2.0. Training models are described by publisher as research/development use; whether Zenodo weight rights authorize commercial/clinical use **is not established**. Keep model disabled in patient workflow until independently cleared.

## What the Opus adapter actually does

\`scripts/real-spine-myeloma-vmi40-expert.py\` accepts a **lawfully available, de-identified original TCIA case** prepared as registered native NIfTI ConvCT, VMI40 and corresponding original expert binary lesion mask. It requires the publisher v1.0.2 source checkout and unpacked original pretrained model tree.

1. Fail closed unless the registered ConvCT/VMI40/expert geometry matches, units are millimeters, expert mask is binary and expert-positive, and input sizes are bounded.
2. Verify original published inference script against its exact Git blob \`f48a665f1fcb8c891ca9d79304d9a4d1c89654ce\`; verify presence of **both** original pretrained task checkpoints including publisher fold_all and store actual SHA256 of weights and inputs. If supplied, hash the 3.7 GB publisher ZIP and compare to published MD5.
3. In opt-in separate NVIDIA GPU >=12GB environment invoke **original author pipeline** (ConvCT→spine→VMI40 lesion). Do not substitute unrelated models or self-generated predictions. Never run automatically during web startup or on Mac M1/8GB.
4. Validate publisher output original voxel grid/affine and execution provenance; calculate voxel TP/FP/FN and Dice, plus lesion component source-voxel bounding boxes.
5. Output only a numeric JSON report; no original CT, patient identifiers, DICOM images, model weights or lesion masks committed to GitHub.

\`\`\`bash
# An isolated authorized GPU machine with existing torch, nnunetv2,
# nibabel, numpy, scipy and pinned upstream publisher checkout/model files.
python scripts/real-spine-myeloma-vmi40-expert.py --mode all \
  --work /tmp/opus-spinal-mm-new \
  --convct /permitted-public/convCT.nii.gz \
  --vmi40 /permitted-public/VMI40.nii.gz \
  --expert /permitted-public/lesions-expert.nii.gz \
  --vendor /opt/Spinal-Multiple-Myeloma-SEG-v1.0.2 \
  --models /opt/original-Zenodo-18598645-unpacked \
  --model-zip /opt/Spinal-Multiple-Myeloma-SEG_nnUNet_models.zip \
  --output /tmp/opus-spinal-mm-numeric.json
\`\`\`

**Validation status:** authentic model and public reference sources established,
code/contract checking may pass, **no genuine original source-paired GPU inference
in this PR**. Hence no Dice, lesion-level sensitivity, and clinical claims.
The exact TCIA source image preprocessing and DICOM SOP navigation require
independent verification. Research model is not wired to clinical patient mode.

Core browser, MPR, local-only patient restrictions and optional LLM are unchanged.
