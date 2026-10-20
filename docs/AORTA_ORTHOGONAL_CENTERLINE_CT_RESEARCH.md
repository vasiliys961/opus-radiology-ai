# Aorta original-CT anatomy mask: centerline-perpendicular plane measurements

New independent pathology-review **quantitative morphology**, not an automatic
aortic aneurysm detection/diagnosis or medical external-wall caliper.

Real source native CT NIfTI and source-grid TotalSegmentator CT `total` aorta
binary anatomical mask are supplied after original **external** permitted
pretrained model inference. The research executable
`scripts/real-aortic-centerline-orthogonal-ct.py` does NOT run/download weights.

The algorithm reconstructs axial-mask centroid positions in physical RAS
millimeters, stabilizes the original midline by a five-slice median filter,
estimates an approximate 3D tangent, samples a physical 2D plane perpendicular
to that tangent at 1.0-mm resolution, computes binary anatomical-mask
cross-sectional area, area-equivalent diameter and maximum sample-boundary
Feret diameter. It reports source axial index and RAS centerline point,
sampling step, selected source CT/mask SHA and all numerical plane
observations. It refuses nonbinary/misaligned, too-short/discontinuous
aorta masks, clipped planes and inadequate source physical geometry.
Largest values represent *sampled binary anatomical mask*, not measured
exterior blood-vessel wall or independently expert-supervised aneurysm size.

Use only an externally validated lawful public source and original anatomy
checkpoint whose genuine trained inference was separately documented:

    python3 scripts/real-aortic-centerline-orthogonal-ct.py \
      --ct /approved/original_CT.nii.gz --ct-sha256 <actual_64_char_SHA> \
      --aorta-mask /isolated/actual_trained_aorta.nii.gz \
      --aorta-mask-sha256 <actual_mask_SHA> \
      --public-source-url https://actual-approved-public-CT \
      --public-source-license 'documented acquisition rights' \
      --approved-public-research \
      --output /isolated/new-aorta-orthogonal-numeric.json

## Critical clinical limits

* This is better oriented than crude axial measurement for angled anatomy,
  but an **anatomical segmentation boundary is not the outer-to-outer wall**,
  and a median-filtered cross-sectional centerline is not a clinician-approved
  vessel path. Branches, ostia, mural thrombus, tortuous/dissected segments,
  large aneurysm masses, motion, segmentation and CT phase can bias output.
* No verified renal artery/infrarenal anatomical landmarks, diameter clinical
  threshold, AAA/dissection/exclusion diagnosis, population accuracy or
  original DICOM Study/SOP-frame localization.
* No image/mask upload, patient mode or heavy inference on Mac M1/8GiB.
  Full 3D masks are processed on an isolated CPU worker with available RAM.
* The GitHub PR CI checks synthetic geometry with straight and angled 3D
  tubes and known native source affine; **no actual trained pretrained
  anatomical forward nor expert 3D vessel measurements in this PR**.
* Next clinical experiment: real source-licensed positive abdominal aneurysm
  CT, authentic TotalSegmentator aorta model and expert centerline-orthogonal
  exterior wall calipers, independently scored. Some vendor tasks/models
  have noncommercial license; obtain authorization before patient use.
