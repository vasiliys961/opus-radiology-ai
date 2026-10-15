# Knee MRI common validation protocol

Both `rsna_knee_dinov2.py` and `rsna_knee_coatnet.py` now require `--manifest`. This is a **breaking CLI change** for future training. It prevents mixing the old independent RNG-based splits.

Create the manifest before training:

```bash
python services/imaging-ai/rsna_knee_validation.py split --gold /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv --out /kaggle/working/knee_split.json --seed 42
```

Pass `--manifest /kaggle/working/knee_split.json` to both trainers. They reject missing and unexpected labeled IDs. Both export `<checkpoint-stem>.validation.csv` containing the same held-out study IDs and 12 aligned probabilities. After both runs complete, use `rsna_knee_ensemble.py` with their two validation CSV files and score each separately using `rsna_knee_validation.py score` and the same manifest.

**Critical scientific limitations:** all 58 original gold labels are still sparse, held-out cohort is ~12 studies, and class-specific AUC may be undefined. This is a repeatable *engineering comparison*, not clinical validation, and does not establish model superiority. The previous DINOv2 checkpoint trained on an old split cannot be compared to a fresh CoAtNet run under this protocol without retraining or inference on the new shared held-out set. Both scripts still process a small subsample of series/slices; report-derived weak labels remain outside the pipeline.
