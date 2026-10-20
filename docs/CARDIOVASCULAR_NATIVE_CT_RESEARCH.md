# Heart, thoracic and abdominal blood vessels: native-CT anatomy metrics

This research-only module adds **actual medical calculations** on already-generated
anatomical label masks; it does NOT retrain or execute a pathology detector.

Original source: TotalSegmentator 2.18.0 public `total` task, separate original
checkpoint and CT provenance. Supported binary labels: heart, aorta,
superior_vena_cava, inferior_vena_cava, portal_vein_and_splenic_vein,
iliac_artery_left/right and iliac_vena_left/right. These are anatomy masks,
not tumor/embolus/stenosis/vascular thrombosis masks. Other separately licensed
tasks must not be silently substituted.

## Example use on legally permitted original public CT

Install minimal nibabel + numpy on the isolated research worker; supply
native (original affine and shape) masks already produced by a verified
external pretrained model.

    python3 scripts/real-cardiovascular-anatomy-native-ct.py \
      --ct /approved/original_ct.nii.gz \
      --ct-sha256 <verified_CT_sha256> \
      --mask heart=/approved/heart.nii.gz \
      --mask aorta=/approved/aorta.nii.gz \
      --mask superior_vena_cava=/approved/superior_vena_cava.nii.gz \
      --public-source-url https://actual-licensed-source \
      --public-source-license 'source-specific confirmed license' \
      --public-deidentified-research \
      --output /isolated/new-cardiovascular.json

Output contains original CT and mask SHA-256, source-grid voxels, millimeter
RAS centroid, source-voxel bounds and anatomical mask volume in milliliters,
plus maximal area-equivalent **axial** diameter in millimeters only for an
almost axial physical grid. Measurements are made by streaming eight slices
at a time, never constructing a new full-volume array. An empty mask is
not a negative clinical study. Native NIfTI RAS does not imply DICOM SOP links.

The **heart segmentation volume is not ventricular function, indexed cardiac
size, or ejection fraction**. Axial mask diameters are not centerline-perpendicular
external-wall clinical vessel diameters. Partial anatomical coverage is not
excluded; ordinary nongated CT cannot confirm dynamic heart function.
No coronary stenosis, pulmonary arterial hypertension, aneurysm, embolism,
thrombosis or normality claims. Dedicated pulmonary artery and heart chamber
tasks are separately licensed/verified; do not substitute pulmonary veins.

The script's CI tests a small synthetic NIfTI CT with known affine, volumes,
bounds and empty/misaligned masks. A green contract run does not imply that
true patient/public CT or trained anatomical inference happened in this PR.
Next: separate licensed full chest/abdomen CT and pretrained masks, real
quantification, clinician comparison with reference measurement, then
source-bound presentation in the Opus reviewer. No patient cloud egress.
