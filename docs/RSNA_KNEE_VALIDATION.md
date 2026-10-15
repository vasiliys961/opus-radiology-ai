# RSNA Knee: auditable study-split and model comparison

**Research-only, no competition predictions or data stored here.**

Both visual training scripts currently make their own seed-based study split. For a meaningful ensemble comparison, use one explicitly saved `validation_manifest.json` with shared held-out study IDs and ensure neither trainer sees validation records when training. The existing training scripts have **not yet been integrated** with this manifest: merely making it does not ensure leakage prevention.

```bash
python services/imaging-ai/rsna_knee_validation.py split --gold /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv --out /kaggle/working/validation_manifest.json
python services/imaging-ai/rsna_knee_validation.py score --gold /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv --manifest /kaggle/working/validation_manifest.json --predictions /kaggle/working/dino_predictions.csv --out /kaggle/working/dino_eval.json
```

This evaluator rejects missing or extra prediction IDs and reports undefined AUC explicitly. It does not produce model predictions. Accurate next step is to wire both training runners to the same manifest, then export DINOv2 validation probabilities as CoAtNet already does. Mean AUC on ~12 validation studies is not clinical evidence.

Never tune ensemble weights or hyperparameters on Kaggle test-set feedback. Model code and weights still require verification of third-party licenses before distribution. No external API is called.
