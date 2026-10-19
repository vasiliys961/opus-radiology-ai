# New lung pathology metric: inspiratory CT low attenuation burden (LAA-950)

This increment provides **actual image-data morphometry code**, not a false claim of a trained emphysema disease classifier. It is a source-bound research postprocessor of **R231-pretrained two-lung segmentation** and HU-calibrated CT.

Original R231: https://github.com/JoHof/lungmask (official labels: 1 = right lung, 2 = left lung).

## Research-only use

On a licensed, de-identified, **full-inspiratory thin-section noncontrast chest CT** converted accurately to HU NIfTI with an already generated real R231 mask in the same native voxel geometry:

    python scripts/real-emphysema-laa950-r231-ct.py \
      --ct /research/approved/inspiratory_ct_native_hu.nii.gz \
      --r231-mask /research/approved/r231_native_mask.nii.gz \
      --output /research/approved/laa950_numeric.json \
      --source-license "CC BY 3.0" \
      --source-url "https://www.cancerimagingarchive.net/collection/lctsc/" \
      --public-research-consent \
      --native-HU-inspiratory-noncontrast-protocol-confirmed

The LCTSC link and license are merely illustrative: source rights, **actual dataset selection**, original HU preservation and model output cannot be inferred from a command line. Do not present the example as a completed real run.

The output contains two mask-bound lung volumes (mL), voxels HU <= -950, corresponding fraction (%) separately for the right and left lungs, whole-lung fraction, HU 15th percentile and native source voxel bounding boxes of low-attenuation regions. CT and mask byte-level SHA-256 are embedded in numeric-only Evidence. Input accepts only original R231 two-lung labels (1 right, 2 left), bounded 3D matched physical-mm affine, finite plausible HU in lung, both lungs and sufficient volume to reject very small partial-slab measurements. It refuses mismatched geometry, truncated/partial lung masks and unrecognised labels. No image, scan, UID, source pixel or identifiers sent to services.

## Scientific basis and limitations

The Fleischner Society 2025 position paper identifies LAA below approximately -950 HU on full-inspiratory CT as a widely used **quantitative imaging biomarker** of emphysema burden (not a stand-alone diagnosis); it is sensitive to lung inflation, tube dose, reconstruction kernel and segmentation:
https://pmc.ncbi.nlm.nih.gov/articles/PMC12091028/

This application computes <= -950 HU, consistent with the table metric definition in the position paper, but does **not** produce clinical-grade corrected densitometry, phenotype classification, stage COPD, confirm parenchymal destruction, explain an airway obstruction or replace PFT. The source NIfTI cannot independently prove inspiratory protocol; that is an operator-attested condition. Do not compare across differing scanners/kernels without harmonisation.

- Genuine R231 is an **anatomy** model; its pretrained weights were used in prior Opus research, but this new LAA adapter does not execute, fetch, or cryptographically verify weights.
- This PR contains code plus technical numerical tests; **no real expert-matched full inspiratory chest CT LAA-950 has been executed here**, so clinical validation is not claimed.
- No patient's CT, cloud API or additional RAM burden on Mac M1 8GB: isolated research worker only. Patient use denied.
- Future: execute independently on a rights-cleared full inspiratory CT with original HU and real R231 output, verify masked source coordinate geometry, calculate independent reviewer-reproducible LAA-950, and eventually compare readers/pathology/spirometry.

Never report absence of emphysema/COPD when LAA is zero, input failed, scan is partial, or acquisition incompatible.
