# Liver and spleen attenuation research — noncontrast CT only

New anatomical-ROI research pipeline reads **original source CT HU** and
exact source-grid pretrained binary liver+spleen segmentation masks.
No new neural network is necessary: once separately trained TotalSegmentator
`total` liver and spleen masks have been generated lawfully and validated,
the script `scripts/real-liver-spleen-ncct-source-hu.py` computes descriptive
liver HU, spleen HU and liver minus spleen median HU from central interior
5-mm eroded ROIs. It streams native axial CT, records each input SHA, physical
grid and selected source slices. No image/mask upload or PHI is allowed.

Needs explicit approved public deidentified research source with verified
rights, truly NONCONTRAST acquisition and original calibrated HU pixels.
Attestation is only operator supplied, not verified independently by code.
The output is descriptive; do not use a fixed HU threshold to automatically
diagnose fatty liver, cirrhosis or fibrosis, especially when intravenous
contrast, diffuse lesions, artifacts, iron deposition, radiation field truncation
or nonstandard reconstruction are present. Central liver erosion does not
exclude every portal vessel or focal mass; original liver masks can be imperfect.

    python3 scripts/real-liver-spleen-ncct-source-hu.py \
      --ct /licensed/original-noncontrast-HU.nii.gz \
      --ct-sha256 <actual_source_CT_sha256> \
      --liver-mask /isolated/trained/liver.nii.gz \
      --spleen-mask /isolated/trained/spleen.nii.gz \
      --public-source-url https://public-source-with-verified-rights \
      --public-source-license 'verified original licence' \
      --approved-public-research \
      --noncontrast-protocol-confirmed \
      --original-HU-calibration-confirmed \
      --output /isolated/new-liver-attenuation.json

This is NOT a cirrhosis detector, FibroScan, histology, steatosis grade,
or complete portal hypertension evaluation. The next module can add
liver/spleen full-volume, contour morphology and verified portal vessel
geometry, but those need full field-of-view and clinical verification.
This PR's CI only tests synthetic NIfTI with known HU and physical
geometry; no original CT true model inference or expert diagnostic
comparison is claimed. No change to patient cloud or default Mac worker.
