# RSNA knee: DINOv2-Small + attention MIL

Research training script: `services/imaging-ai/rsna_knee_dinov2.py`. Genuine pretrained `facebook/dinov2-small` checkpoint is downloaded by Transformers (not bundled), and should be pinned by revision before release. Requires `torch torchvision transformers pydicom pillow scikit-learn numpy` and DICOM JPEG codec dependencies as needed. CPU inference and clinical serving are not connected.

```bash
python services/imaging-ai/rsna_knee_dinov2.py \
  --train-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train.csv \
  --series-csv /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series.csv \
  --dicom-root /kaggle/input/competitions/rsna-knee-abnormality-detection/train_series \
  --output /kaggle/working/dinov2_knee.pt --epochs 2
```

**Limitations:** currently trains only on verified labels, so only 58 gold studies in the original competition CSV. The holdout of roughly 12 is severely underpowered and not an independent clinical validation. Study-level random split, no series leakage within one study; cross-site/patient leakage not assessed. One selected subset of slices per series, no DICOM spatial registration, not lesion localization. Pretrained feature encoder uses ImageNet normalization; domain adaptation required. Full GPU runtime and memory consumption have not been benchmarked. No weak labels are fabricated. Do not send reports to external APIs without permission or export competition data/weights without licence review.
