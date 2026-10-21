# AutoMSC PICAI original fold0 — research inference

This is an **opt-in GPU research executor**, not yet a deployed clinical detector.
It uses the publisher's own `segcls_ensemble_infer.py` from
https://github.com/medfm-flare/AutoMSC-Baseline and the published
`cyyu96/AutoMSC-Baselines` fold 0 checkpoint pinned by revision and SHA-256.

Run it **only** in an isolated Python environment with a verified compatible
publisher checkout and lawfully acquired, de-identified positive PICAI-derived
T2W/ADC/HBV images aligned on the same physical grid.

```bash
python scripts/run-original-automsc-picai.py \
  --t2w /research/study/t2w.nii.gz \
  --adc /research/study/adc.nii.gz \
  --hbv /research/study/hbv.nii.gz \
  --publisher-repo /research/AutoMSC-Baseline \
  --output /research/opus-picai-run \
  --device cuda
```

First install the publisher project (its exact commit and dependency lock must
be recorded in a reproducible research run), `nibabel`, and
`huggingface_hub` in the isolated executor. Heavy packages are not installed
into browser or Mac client. The runner refuses inconsistent channel geometry,
wrong checkpoint hash, missing publisher implementation and missing output.
Reports include a mask SHA, native affine, tumor label 2 voxel count/volume,
bounding voxels, and optional voxel Dice against a separately provided
expert mask. It does not fabricate a negative diagnosis when tumor voxels are
zero. Classification output is retained as publisher `results.csv`; its
calibration and ISUP reliability have not been validated.

**Current evidence boundary:** original 520 MiB pretrained checkpoint SHA was
verified in PR #356. This increment supplies a native execution entry point,
not proof that trained forward has succeeded. Do not set detector coverage to
`real_case_measured` until a real positive permitted source case, actual
successful execution, native overlay and independent metrics are recorded.
PICAI training-data overlap must be assessed; CC-BY-NC research-only rights
prohibit automatic commercial deployment.
