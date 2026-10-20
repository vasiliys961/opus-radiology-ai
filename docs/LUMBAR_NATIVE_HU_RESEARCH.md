# Opportunistic lumbar L1-L5 CT attenuation (NOT DXA) — research only

The executable **real code** `scripts/real-lumbar-opportunistic-native-ct-hu.py`
accepts *authorized public deidentified* **noncontrast** CT with calibrated
original DICOM-to-HU source pixels and original exact-grid 3D binary
`vertebrae_L1` ... `vertebrae_L5` masks (e.g. TotalSegmentator 2.18.0 total).
Requires explicit attestation of study rights, noncontrast acquisition and
correct original HU calibration. Operator assertion cannot prove them.

The script uses original NIfTI affine, enforces native voxel grid and SHA,
reads axial slices without allocating a full-volume float32 copy, excludes
the superior/inferior quarters of each vertebra's axial coverage, samples
pixels at least 4 mm from the vertebra segmentation's two-dimensional
boundary, then calculates ROI median, mean, P10/P90, SD in CT HU.
Per-vertebra exact CT and anatomical-mask SHA256 and ROI voxel counts
are exported in numerical JSON; source patient data do not leave research
host. A fully absent vertebra/misaligned mask is an error, NOT negative.

This is a central **vertebral segmentation** attenuation ROI, and is
**not guaranteed to exclude the cortical shell, posterior elements,
venous basivertebral channel, fractured vertebra, hemangioma, metal or
local sclerosis**. It is not clinical vertebral-body trabecular calibration.
No automatic osteopenia/osteoporosis, fracture, BMD g/cm2, FRAX, DXA
T-score, or treatment threshold can be inferred. Contrast-enhanced scans,
unknown HU conversion, non-axial/sheared geometry and overly thick slices
are refused. Results need expert spine-level masks and a real independent
cohort against clinical DXA before medical interpretation.

Example with a real independently verified permitted public study:

    python3 scripts/real-lumbar-opportunistic-native-ct-hu.py \
      --ct /licensed/source-true-HU-noncontrast.nii.gz \
      --ct-sha256 <verified-public-CT-SHA256> \
      --level-mask L1=/isolated/vertebrae_L1.nii.gz \
      --level-mask L2=/isolated/vertebrae_L2.nii.gz \
      --public-source-url https://real-original-public-source \
      --public-source-license 'verified study license' \
      --approved-public-research \
      --noncontrast-protocol-confirmed \
      --original-HU-calibration-confirmed \
      --output /isolated/new-spine-numeric.json

The PR CI runs only deterministic synthetic NIfTI numerical tests;
no new imaging inference on an authentic CT is claimed by that CI.
Next stage: full permitted CT already segmented with TotalSegmentator,
verify original HU tag conversion independently, compare ROI against
radiologist trabecular measurements, and evaluate acquisition/reconstruction
dependence. This does not enable patient/cloud mode or force GPU use.
