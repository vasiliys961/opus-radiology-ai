# Opt-in loss balancing in knee MRI experiments

Use `--class-balance` with the paired runner to add capped positive weights to the masked BCE loss. Positive and negative counts come **exclusively from the training partition**, never from validation or test. Missing labels remain unknown and are excluded from the objective. Maximum weight is 5. No-positive and no-negative classes default to weight 1, rather than generating invalid infinity.

Checkpoint provenance stores the resulting weights and counts; inference is unchanged. Default remains off so the old experiments and weights remain comparable.

```bash
python services/imaging-ai/rsna_knee_compare.py --class-balance --work /kaggle/working/class_balance_run
```

No increased AUC is claimed. On ~46 training studies, weights are unstable and may overfit; this change requires a fresh GPU run to evaluate.
