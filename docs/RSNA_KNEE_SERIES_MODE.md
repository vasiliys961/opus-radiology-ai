# Opt-in series-selection experiments, with checkpoint replay

The default for DINOv2, CoAtNet, and the paired training runner is **legacy** (original sorted SeriesInstanceUID selection). Existing downloadable weights remain compatible.

For a **new** experiment, `--series-selection balanced` uses sagittal/coronal/axial round-robin sampling in both training and held-out validation. New checkpoints record `series_selection`. Offline inference reads the mode from each checkpoint and reproduces it automatically; old checkpoints missing the field default to `legacy`.

New Kaggle run, only when GPU is intentionally enabled:

```bash
python services/imaging-ai/rsna_knee_compare.py --series-selection balanced --epochs 2 --work /kaggle/working/balanced_run
```

Use a fresh `--work` directory per experiment. Compare to the saved `knee_comparison_summary.json` from the initial legacy run; still limited to ~12 validation studies and may not be statistically meaningful. No performance improvement is claimed without actual GPU data.
