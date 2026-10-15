# RSNA Knee MRI — secondary CoAtNet MIL and ensemble

Second research encoder is `timm coatnet_0_rw_224`, using ImageNet pretrained weights and per-study attention pooling across selected DICOM slices. Download is performed only on explicitly run Kaggle training. No new weights were trained or clinically assessed in CI.

```bash
pip install timm pydicom pylibjpeg pylibjpeg-libjpeg pylibjpeg-openjpeg scikit-learn
python services/imaging-ai/rsna_knee_coatnet.py \
  --train-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv \
  --series-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series.csv \
  --dicom-root /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series \
  --output /kaggle/working/coatnet_knee.pt --epochs 2
```

Once BOTH models produce `StudyInstanceUID` + the same 12 columns on the **same cohort**, average independent predictions with:

```bash
python services/imaging-ai/rsna_knee_ensemble.py \
  --dinov2 /kaggle/working/dino_predictions.csv \
  --coatnet /kaggle/working/coatnet_predictions.csv \
  --out /kaggle/working/ensemble_predictions.csv
```

AUC from 58 labeled studies / ~12 validation studies is statistically very unreliable and insufficient to claim the ensemble is better. The old DINOv2 script does **not yet export validation CSV**; this must be implemented before ensemble evaluation. Check timm model identifier and runtime on actual Kaggle before treating CoAtNet as runnable there. Do not use competition test predictions or labels to select blend weights. No patient use and no external export of RSNA reports.
