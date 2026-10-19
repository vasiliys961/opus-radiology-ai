# NEW pathology workstream: pelvic bone fracture fragment localization on 3D CT

## Clinical target

Pelvis had **no verified pretrained pathology-specific model** in the Opus research catalog. The [original FracSegNet project](https://github.com/YzzLiu/FracSegNet) (Liu et al, MICCAI 2023) publishes a two-stage fracture-specific nnU-Net method: initial segmentation of sacrum/left/right hemipelvis followed by pelvic fragment segmentation. **Published pretrained models** are linked from that upstream repository's \`code/inference/{AnatomicalSegModel,FractureSegModel}\` directories, currently via Google Drive; weights are **not downloaded, hashed or executed in this PR**. Original software license is MIT; the separate pretrained files and research image license require their own legal checks. The original nnU-Net 1.7 training code needs an isolated compatible Linux GPU runtime, minimum vendor stated 10GB VRAM.

Official PENGWIN 2024 task 1 training data and reference masks: https://zenodo.org/records/10927452 (100 public training cases from a 150-person source cohort; no public official independent holdout). Researchers should verify source terms: Zenodo metadata reportedly says CC BY 4.0, while other authors/mirrors have stated CC BY-NC-SA; do **not** assume broad commercial rights. Source masks encode anatomical fragments, not a discrete cortical fracture-line label: \`1..10\` sacrum; \`11..20\` left hipbone; \`21..30\` right hipbone. Single apparent fragment can occur with an undetected/non-displaced injury, and several apparent pieces do not prove an acute fracture.

## New **executable** Opus functionality

\`scripts/real-pelvic-fracsegnet-fragment-evidence.py\` accepts a *public deidentified CT* in .mha or .nii[.gz], plus a same-geometry 3D instance-label image with precisely verified PENGWIN encoding (either licensed original expert annotations or independently generated **genuine** FracSegNet output if its actual label encoding has been documented and mapped). Handles MHA LPS-to-NIfTI RAS coordinate conversion, rejects mismatched affine, wrong labels, truncated/symlinked files, unbounded size and unsafe output path; exports numeric-only source/label SHA-256, per-piece physical volumes and 3D bounding boxes and RAS centroids. Groups candidates by sacrum, left hipbone, right hipbone; flag \`multiFragmentReviewCandidate\` for two or more significant components, **not** diagnosis.

With optional exact-grid expert mask, computes whole-bone Dice and best-instance matching with Hungarian assignment to avoid arbitrary instance-ID mismatch. **Bone-union Dice is not fracture-line Dice**, and training-set comparison is NOT independent lesion accuracy.

Run on already-cleared public source, for instance, after locally obtaining real licensed PENGWIN original CT and aligned expert mask:

    python scripts/real-pelvic-fracsegnet-fragment-evidence.py \
      --public-ct /isolated/PENGWIN_001.mha \
      --fragment-mask /isolated/PENGWIN_001_fragments.mha \
      --output /isolated/fragments-only-numeric.json \
      --source-license "CC BY-NC-SA 4.0" \
      --public-deidentified-research-rights-confirmed

Using original expert mask exercises spatial analysis, **not model inference**. A genuine model-output study requires running upstream pretrained weights separately with compatibility to its **actual output label schema**. Do not silently treat binary segmentation or local 1..10 labels as native 1..30 PENGWIN instance IDs.

## State and gates

1. Fracture-specific **publisher research method and pretrained download links found**, license and checkpoint file SHA not confirmed.
2. Source-grid fragment handling and 3D numeric evidence **implemented**; regression CI is synthetic and not published-model inference.
3. Real positive PENGWIN CT against trained FracSegNet model, exact checkpoint SHA, licensed deployment, independent expert lesion metrics, M1/Safari 8GiB footprint, sensitivity/FP per case and physician acceptance **NOT yet obtained**.
4. Any model pretraining/training cohort overlap invalidates claims of independent clinical accuracy. Need a truly disjoint expert test set before clinical use.
5. No automatic API use, patient data upload or model weights within Git repository. This module remains **research only**.

Next engineering increment: isolate untrusted original nnU-Net 1.7 code/weight deserialization in a pinned network-disabled GPU container; download/checksum the three published genuine checkpoint assets; verify native output semantics and build a complete CT → original anatomical and fracture model → 3D fragments → expert verification path. If output is binary per region, map only after proving anatomy/label equivalence.
