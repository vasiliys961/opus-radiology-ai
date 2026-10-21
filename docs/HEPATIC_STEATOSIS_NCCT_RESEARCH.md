# Liver/spleen source-native attenuation on verified research NCCT

**New useful hepatic fat-associated quantitative marker — not a steatosis
diagnosis or a pretrained pathology detector.** Applies original noncontrast
abdominal CT Hounsfield-unit data plus separate, source-grid-aligned **binary
liver and spleen anatomical masks** supplied from a previously verified
original pretrained organ segmentation workflow (e.g. TotalSegmentator).
This adapter **does not run** organ AI inference or validate the weight SHA
on its own; it does not turn anatomy into a learned steatosis classifier.

The offline script `scripts/real-hepatic-steatosis-ncct.py` strictly requires
original NIfTI 3D CT and both ordinary binary masks in matching RAS-mm voxel
affine and shape; refuses absent/mislabeled, tiny/truncated, overlapping
organ masks, implausible sizes, absent physical mm, nonfinite HU or
clearly implausible parenchymal attenuation. It erodes the anatomy
masks two native voxels and samples the central 10%-90% CT intensities;
returns liver/spleen trimmed mean, median, IQR, liver-minus-spleen
median **HU difference** and median HU ratio with original source and
each mask's real SHA256. No images/voxels/identifiers are written to
the numerical evidence report.

**Operator-confirmed inputs only:** source must be a lawful public,
deidentified original truly **noncontrast** CT with verified HU
RescaleSlope/Intercept and rights reviewed. CT NIfTI pixels cannot
prove DICOM contrast history or rescale calibration: the script exposes
these as **operator-attested, not independently DICOM verified**.
Intravenous contrast, iron deposition, storage disease, beam hardening,
incorrect mask, prior resection, tissue heterogeneity and patient
factors can invalidate attenuation comparisons. CT attenuation alone
misses mild disease and does not quantify histological liver fat
fraction, fibrosis/cirrhosis or staging.

Run only on an authorized isolated Linux research host:

```sh
python scripts/real-hepatic-steatosis-ncct.py \\
  --ct /approved/public/original_ncct.nii.gz \\
  --liver-mask /approved/pretrained/liver_mask.nii.gz \\
  --spleen-mask /approved/pretrained/spleen_mask.nii.gz \\
  --output /approved/numeric-only-hepatic.json \\
  --public-source-url https://actual-approved-public-research-source \\
  --public-source-license 'verified original public research terms' \\
  --native-noncontrast-acquisition-reviewed \\
  --hu-rescale-calibration-reviewed
```

The numerical report never outputs an automatic normal/abnormal cut-off
or diagnosis. Without histology or MRI-PDFF and an independent
positive cohort, sensitivity/specificity are **unmeasured**.
No clinical/patient-cloud use or model download is enabled.
The script prevents direct Mac M1/8GiB runs. Offline unit tests validate
only numeric geometry/units and fail-closed behavior on synthetic
arrays, **not real pretrained liver segmentation or a steatosis case**.

**Next genuine evidence gate:** source-rights-cleared full noncontrast
abdominal CT with positive independently labeled hepatic steatosis,
original trained TotalSegmentator full liver+spleen forward in original
source coordinates, physician-reviewed HU and CT protocol,
then compare liver-spleen HU difference to independent reference
and repeat across heldout positives/negatives. Do not upgrade
this from candidate on the basis of a green CI.
