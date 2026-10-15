# DINOv2 offline inference from an already downloaded checkpoint

The script below accepts the **existing** `dinov2_knee.pt` produced by the first 2-epoch experiment. No training and no pretrained-weight download occurs during prediction. The DINOv2 network is reconstructed from an internal configuration and a strict state dictionary load. DICOM remains local to Kaggle.

```bash
python services/imaging-ai/rsna_knee_dinov2_predict.py \
  --weights /kaggle/input/YOUR_PRIVATE_WEIGHTS/dinov2_knee.pt \
  --studies-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/test.csv \
  --series-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/test_series.csv \
  --dicom-root /kaggle/input/competitions/rsna-knee-abnormality-detection/test_series \
  --output /kaggle/working/dinov2_predictions.csv
```

The competition's exact test paths and expected submission format **must be verified first**; this illustrates invocation, not a ready-to-submit Kaggle notebook. A controlled, pre-existing checkpoint does not provide clinical validity. Prior DINOv2 training used an earlier random split and cannot be retrospectively treated as part of the new shared-split experiment. The script writes a `.partial` file then atomically publishes the completed CSV; missing DICOM or incompatible weights abort inference rather than emitting partial predictions.
