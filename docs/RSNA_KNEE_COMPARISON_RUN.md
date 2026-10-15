# Knee MRI two-model Kaggle comparison runner

Run in Kaggle only after the RSNA dataset is attached and GPU enabled. This research task trains both DINOv2-Small and CoAtNet on exactly the same labeled-study split, saves their individual weights, prediction CSVs, ensemble CSV, per-label AUC and summary JSON. It deliberately does **not** invoke any external LLM or transmit radiology reports.

Requirements for this optional environment: `torch torchvision transformers timm pydicom pillow scikit-learn numpy pylibjpeg pylibjpeg-libjpeg pylibjpeg-openjpeg`.

```bash
python services/imaging-ai/rsna_knee_compare.py --epochs 2
```

Pretrained weights may be fetched from model hosts while internet is enabled. Input RSNA data remain in Kaggle; no external API receives report text. GPU memory and execution duration have not been verified on T4 yet. CoAtNet model ID availability must be confirmed at runtime. This is **not a ready competition submission**: only 58 labeled studies exist, no held-out clinical cohort or calibrated safety thresholds are available, and an AUC from ~12 test studies is unstable. Any score improvement must be established empirically, not inferred from ensemble construction. Prior checkpoint `dinov2_knee.pt` used a different split; it cannot be mixed with new comparison output.
