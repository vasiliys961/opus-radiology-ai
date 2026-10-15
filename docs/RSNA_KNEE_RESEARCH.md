# RSNA Knee MRI: research-only training baseline

This is a **real image-to-label training entrypoint**, not a validated diagnostic detector. It never downloads weights or sends images to external APIs. Dataset access, eligibility, and MIRA license obligations must be independently satisfied. Do not upload competition DICOM or patient data to GitHub.

The current baseline uses a **ResNet18 slice encoder + attention MIL**, not DINOv2. DINOv2 remains a subsequent experiment; no pretrained weights are bundled. The model predicts 12 study-level labels, **not** lesion masks or localization.

Expected CSVs: `train.csv`, `train_series.csv`, `test.csv`, `test_series.csv` as defined in the competition. Unlabelled training conditions are masked out; reports do not enter inference. If only a small subset has labels, add licensed weak-label extraction upstream and validate carefully.

Optional Kaggle environment: `torch torchvision pydicom pylibjpeg pylibjpeg-libjpeg pylibjpeg-openjpeg numpy pillow scikit-learn`. DICOM codecs vary: unreadable slices are skipped, and studies with no supported slices fail closed. The model is computationally expensive on full studies; adjust `--slices`, `--series-limit`, GPU and training duration. The inference runtime is not yet benchmarked for the contest's offline/time limits.

Example, with actual mounted Kaggle paths:
```bash
python services/imaging-ai/rsna_knee.py train --csv /kaggle/input/rsna/train.csv --series /kaggle/input/rsna/train_series.csv --root /kaggle/input/rsna/train_series --out /kaggle/working/knee.pt --epochs 3
python services/imaging-ai/rsna_knee.py predict --csv /kaggle/input/rsna/test.csv --series /kaggle/input/rsna/test_series.csv --root /kaggle/input/rsna/test_series --weights /kaggle/input/knee-checkpoint/knee.pt --out /kaggle/working/submission.csv
```
`--pretrained` accepts a **locally supplied torchvision ResNet18 encoder state_dict**. Without it training is from random initialization; quality is unproven.

Training split is at the study level, one holdout only; AUC is reported per label when both classes exist, otherwise null. This is not a statistically adequate independent clinical validation. Before any real-world integration: independent labels, class-specific sensitivity/specificity and calibration, leakage audit, license check and physician assessment are required.

Contract tests: `python -m unittest discover -s services/imaging-ai -p test_rsna_knee.py`.
