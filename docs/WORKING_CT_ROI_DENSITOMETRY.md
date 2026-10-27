# Working physician feature: local CT tissue density ROIs

Open an original single-frame uncompressed CT in the main DICOM viewer. Under
the viewer, the **КТ · измерение плотности тканей (HU)** panel renders the
original frame locally. The physician clicks the center of a circular ROI,
adjusts its pixel radius and gets real source pixel measurements:

- DICOM rescale-calibrated mean and median HU, SD, P10, P90, range, histogram
- Original pixel-count and area in mm² from DICOM PixelSpacing
- Up to 16 retained manual ROIs in the current source series, with anatomical
  labels assigned **by the physician**, not by an algorithm
- Mean liver-minus-spleen difference when both organs have manually selected
  ROIs, and an optional local JSON with the original source Series/SOP UIDs.

Unlike research-only model launchers, this gives the physician a direct
measurement on the currently displayed **real pixel values**, including signed
DICOM samples and HighBit shifts. It never invents organ localizations, masks,
osteoporosis, liver fat, cirrhosis or tumor diagnoses.

Input scope: original, uncompressed single-frame monochrome Little Endian CT;
valid RescaleSlope/Intercept; **RescaleType explicitly HU**; supported
PixelSpacing and geometry; circle must fit entirely inside the image. This
initial bounded tool intentionally refuses some valid compressed and enhanced
DICOM series; in those studies the Cornerstone viewer still works, but this
additional HU ROI tool reports unsupported rather than a false number.

Limitations: noncontrast phase not auto-confirmed; vascular/lesion exclusion,
L1 trabecular localization, quantitative BMD phantom/calibration and
independent diagnostic thresholds are not established. User-selected anatomy
is not anatomical segmentation. Saved JSON contains source DICOM UIDs and must
remain local unless a separate lawful basis exists.

Owner strategic directive is permanently recorded at top of `AGENTS.md`:
prioritize working clinician functionality and genuine trained pathology
detectors, not standalone scaffolding or synthetic CI-only increments.
