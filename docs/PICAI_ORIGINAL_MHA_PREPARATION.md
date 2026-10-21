# Original PI-CAI MHA → AutoMSC T2W/ADC/HBV preparation

Source: https://pi-cai.grand-challenge.org/DATA/ (public training and
development images, CC BY-NC 4.0) and expert annotations maintained in
https://github.com/DIAGNijmegen/picai_labels.

The published MRI channels have different grids and are not necessarily
registered. `scripts/prepare-original-picai-mha.py` explicitly checks
field-of-view and centers, then **resamples in physical space** to the T2W grid.
This is NOT an image registration algorithm; residual patient/sequence motion
is not corrected. Reject nonoverlap rather than claiming compatibility.
The native MHA source images stay intact. Source/output SHA-256 and grid
metadata are preserved in `preparation.json`.

Required separately installed `SimpleITK`, `numpy` in an isolated research
environment. Use only a legally downloaded deidentified case and record case
selection, positivity, fold overlap, and expert-mask source independently.

```bash
python scripts/prepare-original-picai-mha.py \
  --t2w /research/case_t2w.mha --adc /research/case_adc.mha \
  --hbv /research/case_hbv.mha --out /research/prepared_case
```

The files `t2w.nii.gz`, `adc.nii.gz`, `hbv.nii.gz` feed the opt-in
`scripts/run-original-automsc-picai.py` executor. The PI-CAI expert
csPCa mask is **multi-class**: ISUP 2/3/4/5 are positive lesion values;
the AutoMSC tumor *prediction* label is class 2. The expert-mask comparison
uses labels 2..5 by default. Expert masks also need the same affine/grid;
prepare a separate reviewed nearest-neighbor resampling if they differ.

This preprocessing and CI compile do not count as a positive trained-model
forward, independent clinical validation, or native DICOM overlay. Full
AutoMSC integration and final registration QA remain pending.
