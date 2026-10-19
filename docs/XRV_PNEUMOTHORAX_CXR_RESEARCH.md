# Original NIH pretrained chest X-ray pneumothorax classifier: research pathway

## Medical task

Adds a new X-ray modality distinct from current CT/MR analysis: **genuine pretrained TorchXRayVision DenseNet121 NIH checkpoint** for the image-level Pneumothorax pathology label.

Publisher: https://github.com/mlmed/torchxrayvision
Original release: https://github.com/mlmed/torchxrayvision/releases/tag/v1
Original trained checkpoint: nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt (publisher reports 28,382,096 bytes).
Pinned library: torchxrayvision 1.5.7; model ID densenet121-res224-nih.

## Implemented executable

scripts/real-xrv-pneumothorax-cxr.py requires 8-bit rights-cleared **public deidentified PNG** radiograph, original preinstalled publisher weights, SHA256, source URL and rights terms. It checks filenames/byte-bounds/hashes, normalizes/crops/resizes using XRV transforms, runs true model forward on a separately provisioned **Linux research CPU** worker, selects the unique specifically trained Pneumothorax pathology head, and returns a numeric-only JSON with model and source SHA256, output image-level score and explicit limitations.

**It is NOT a localising pneumothorax detector.** The score is uncalibrated, not a radiologist diagnosis, not a negative screen, and provides no pleural line, pneumothorax volume or actionable emergency recommendation. Do not invent a bounding box for a scalar score.

Important execution caveat: XRV legacy checkpoint loader uses torch.load(weights_only=False); signed/hashed weights remain pickle. The original publisher archive must be independently vetted and executed **only in an isolated research Linux worker**, not on the user's Mac or patient device. Cloud and patient paths remain disabled.

## Genuine public pretrained inference in CI

The GitHub Actions file .github/workflows/xrv-pneumothorax-original.yml installs CPU PyTorch and pinned XRV, downloads the publicly supplied TorchXRayVision example CXR tests/00000001_000.png and the **real** publisher 28-MB NIH checkpoint, verifies its observed SHA256 and executes the actual trained forward pass; only numerical original/model/source hashes and uncalibrated score are printed. No original image/model weights uploaded to Actions artifacts or GitHub.

**Do not claim real inference until the run actually succeeds.** After a successful workflow, record the actual run, checkpoint SHA and numeric result. It does not establish that this publisher demo radiograph is positive for pneumothorax, is independent from training, or has an expert lung/pleura reference.

## Source rights and independent diagnosis

Source XRV image: https://github.com/mlmed/torchxrayvision/tree/main/tests
NIH original dataset: https://nihcc.app.box.com/v/ChestXray-NIHCC
XRV pretrained model card: https://huggingface.co/torchxrayvision/densenet121-res224-nih

NIH Clinical Center ChestXray FAQ supplies **custom terms, not a CC0 or CC BY statement**, requiring proper attribution, acknowledgement and original dataset link. Confirm the publisher sample's rights and training-set overlap before any reuse outside this bounded research workflow.

Outstanding: independently confirmed positive and negative licensed external chest X-rays, manual expert labels or pneumothorax localization mask, sensitivity, specificity, AUROC, FROC (for a separate localizing model), calibration and prospective physician review. Original source sample model score does not prove diagnosis. Code supports only isolated research, no patient mode.


## Observed TRUE pretrained model research run — 19 October 2026

- GitHub Actions real public publisher smoke: https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39242605402 ; original model forward completed **successfully** (not a synthetic contract).
- Genuine publisher-trained NIH DenseNet121 checkpoint SHA-256: `31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf` (28,382,096 bytes per publisher).
- Original publisher demo CXR tests/00000001_000.png SHA-256: `c8cbe59e6b9b186060dc68e63965658fa6b5b3ada6648d25c189b8b69b43cd4c`.
- Actual NIH pretrained Pneumothorax **model output 0.172315**, uncalibrated original model score for this image. Not a 17.2% clinical probability, not a negative screen. The sample's pneumothorax disease state is not established.
- Both original downloaded files now have exact SHA-256 checks in PR CI; no patient/model binary artifacts saved.
- Still **NO independent radiologist pneumothorax positive/negative labels, no sensitivity/specificity, no spatial localization, no clinical patient mode**.


## Multitask extension: cardiomegaly and pleural effusion on X-ray

The *same* publisher NIH-trained DenseNet121 forward also has verified-by-publisher-trained **Cardiomegaly** and **Effusion** output heads, as documented in the TorchXRayVision original NIH label map. Opus now extracts and safeguards those two additional image-level scores in the original model's single pass, together with Pneumothorax; no extra model, weight download, GPU or patient communication.

CI rejects a missing/untrained/ambiguous head, NaN score, scores outside [0,1] and absence of explicit spatial localization disclaimers. The actual output values must be recorded only after the new public Actions run completes successfully.

**Neither output is a cardiothoracic ratio or effusion volume.** This model does not measure heart silhouette geometry, discriminate AP magnification, establish fluid laterality or diagnose heart failure. Negative scores do not exclude cardiomegaly, effusion or pneumothorax; no clinician-verified expert positives, independent validation or spatial masks exist yet.

Reference NIH trained pathology labels: https://huggingface.co/torchxrayvision/densenet121-res224-nih


## True original NIH multitask forward — verified on 19 October 2026

In the same genuine original model inference on publisher sample tests/00000001_000.png, all three publisher-trained output heads completed successfully. GitHub Actions run: https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39243434172

- Pneumothorax: **0.172315**
- Cardiomegaly: **0.667162**
- Effusion: **0.566473**
- Checkpoint SHA-256: 31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf
- Original sample SHA-256: c8cbe59e6b9b186060dc68e63965658fa6b5b3ada6648d25c189b8b69b43cd4c

These numbers are the **raw uncalibrated model outputs on the publisher sample**, not a 66.7% verified clinical probability of cardiomegaly or a 56.6% verified probability of pleural effusion. No expert truth/independent holdout, disease localization, sensitivity, specificity, or clinical use has been established.


## Multi-label extension: pneumonia, pulmonary edema, lung mass

The same **original trained** NIH DenseNet121 also publishes class-specific heads for **Pneumonia**, **Edema** and **Mass**. The standalone research-only source-registered classifier exposes all three on the SAME exact original CXR with no second model, and explicitly refuses non-publisher or untrained class names. Original head list source: https://github.com/mlmed/torchxrayvision/blob/main/torchxrayvision/models.py

These outputs are image-level **uncalibrated classifier scores**, not diagnosis or localizing lesion segmentations. In particular:
- Pneumonia head does **not** prove infectious pneumonia (viral vs bacterial, etc.); radiographic opacity needs expert interpretation.
- Edema head is not a quantitative measure of lung water, nor proof of cardiogenic edema.
- Mass head is not confirmed lung cancer or a bounded tumor and has no source coordinates.

Original sample may overlap training, no expert positive labels or independent validation; no patient/cloud. Record actual numbers only after the updated official pretrained Actions forward completes.
