# Knee MRI ablation experiment

Four DINOv2 runs each change **one** input or objective dimension relative to the baseline:

1. Original sorted series, percentile pixels, unweighted loss (baseline).
2. Plane-balanced MRI series, original pixels, unweighted loss.
3. Original series, DICOM-aware intensity transform, unweighted loss.
4. Original series, original pixels, capped positive class weights based only on training studies.

All use the same deterministic gold study split and seed, separate directories/checkpoints and per-label validation evaluation. This design avoids conflating independent modifications. CoAtNet and an ensemble should be tested only after selecting scientifically justified candidates **without tuning on the test set**.

Run on Kaggle with GPU only after planning compute budget:

```bash
python services/imaging-ai/rsna_knee_ablation.py --epochs 2
```

Four full DINOv2 runs are materially more expensive than the original two-model test; keep the GPU off until explicitly ready. Compare against the previously downloaded baseline but note that other software versions, RNG state and execution conditions may differ. Accuracy claims require multiple seeds or an external gold cohort. Only 12 studies are in validation; treat all AUC differences as exploratory. Outputs may include competition-derived identifiers and should remain private.
