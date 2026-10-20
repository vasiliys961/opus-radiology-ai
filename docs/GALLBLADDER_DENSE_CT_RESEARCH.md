# Research-only hyperattenuating gallbladder CT findings (NOT gallstone exclusion)

New executable `scripts/real-gallbladder-dense-calculus-ncct.py` adds a
gallbladder lumen localization candidate feature using **source-original
true-HU noncontrast CT** and an **externally executed** real pretrained
gallbladder anatomical mask from TotalSegmentator 2.18.0 `total`.

- Requires exactly native 3D affine/shape with physical units, source and
  mask exact SHA256, and explicitly documented noncontrast HU conversion.
- Operates within organ bounds, keeps a 2.5-mm projected interior-only ROI
  to reduce gallbladder wall confusion, selects voxel HU >= 180 by default
  (restricted research range 150-350) and computes connected 3D components
  of >=3 voxels, candidate volume mm3, center RAS mm and bounding voxel box.
- Captures numerical source and mask hashes only, no CT/masks/UID/cloud.
  No GPU/LLM or retraining; tests are synthetic geometry/known HU only.

This cannot detect most radiolucent/cholesterol gallstones, reliably
distinguish calcified gallstones vs wall calcification/metal/contrast,
assess stones outside gallbladder (common bile duct) or confirm acute
cholecystitis. Ultrasound remains clinically important for gallstones.
Even a completely empty result is not a negative gallbladder examination.
Anatomical masks are not pathology-trained weights. No sensitivity,
specificity, false positive rate or physician diagnostic validation exists.

    python3 scripts/real-gallbladder-dense-calculus-ncct.py \
      --ct /approved/original-noncontrast-HU.nii.gz \
      --ct-sha256 <exact_original_SHA256> \
      --gallbladder-mask /already-trained/gallbladder.nii.gz \
      --gallbladder-mask-sha256 <actual_gallbladder_mask_SHA256> \
      --public-source-url https://documented-original-source \
      --public-source-license 'verified study reuse terms' \
      --approved-public-research --noncontrast-CT-confirmed \
      --original-HU-calibrated \
      --output /isolated/new_numeric_candidate.json

The original pretrained anatomical task must be executed separately with
lawful model weights, provenance and verified CT geometry. Next validation:
public CT with radiologist/US-confirmed calcified gallbladder stone, complete
native DICOM source and independent false-positive measurements, not a
synthetic threshold pass. Patient mode/cloud remain disabled.
