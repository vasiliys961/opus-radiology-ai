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
