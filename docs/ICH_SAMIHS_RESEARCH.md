# PATH-ICH-01 — real pretrained SAMIHS ICH inference adapter

Status: **adapter implemented on a feature branch; genuine trained inference on an independent public CT is NOT verified by Opus**. No patient use. No clinical performance claims.

## What this adds

`scripts/run-samihs-ich-public.py` calls the **actual vendor wrapper** `segment_ich.py` with a separately installed, pre-trained SAMIHS checkpoint (not a synthetic or untrained stand-in). It requires a distinct public 3D NIfTI brain CT, the checkpoint, wrapper, and expected SHA-256 digests. Input and mask must be 3D, and the exact native shape and RAS affine must match; otherwise it aborts. Output is a `uint8` binary NIfTI and `opus-ich-samihs-public-report.json` with measured candidate mask volume, voxel bounds, individual binary connected-component volumes, model/source SHA, and limitations.

The JSON deliberately has `sourceDicomSopBound=false`, `independentDice=null`, `clinicalValidation=false`. A binary mask cannot diagnose ICH subtype; zero predictions are *not* a negative diagnosis.

## Source and model applicability

Published model bundle: https://huggingface.co/MooreMuaMu/samihs-ich-segmentation (model card labels license MIT). Original paper: https://arxiv.org/abs/2311.08190.

Published interface: 3D NIfTI `(.nii|.nii.gz)` -> 2D per-slice inference -> 3D binary `uint8` mask. Default percentile clipping 0.5–99.5%; normalization to [0,1]. Default slice-axis auto is **not allowed by this adapter**: verify axis and specify 0, 1, or 2. The model card describes CUDA inference; performance, applicability of absolute HU, checkpoint training overlap and clinical sensitivity have not been independently checked.

Published model-card MIT license is not by itself clearance for all pretraining assets, checkpoint rights, dependencies, datasets or commercial clinical use.

## External research execution only

Provision the Hugging Face repository at an audited immutable revision **outside the Opus repository** on an authorized CUDA GPU runner with >=12 GiB VRAM (conservative research admission, not a benchmark). Audit its Python and serialized PyTorch checkpoint before invoking. Copy only a **lawfully usable, correctly oriented public** NIfTI into the private runner directory. Hash all three files and supply them explicitly.

```bash
python scripts/run-samihs-ich-public.py \
  --model-dir /research/installed-samihs \
  --input /research/public-head-ct.nii.gz \
  --output-dir /research/new-ich-results \
  --source-sha256 <64-hex-digest> \
  --checkpoint-sha256 <64-hex-digest> \
  --wrapper-sha256 <64-hex-digest> \
  --slice-axis 2 --batch-size 1 --threshold 0.5 \
  --device cuda:0 \
  --public-research-authorization PUBLIC-ICH-RESEARCH-ONLY
```

The runner executes `segment_ich.py` **from the independently audited installed model checkout**. This script may use a PyTorch checkpoint format capable of code execution: only run code/weights from a verified trusted revision inside an isolated environment. The adapter makes no network calls or checkpoint downloads itself. Offline environment variables are set for Hugging Face and Transformers, but this is not a replacement for network isolation/firewall.

No patient CT may be placed in GitHub Actions, exported as CI artifacts, or passed to external model providers. The public runner should be isolated from patient workstations.

## Acceptance still required

1. Real public-CT GPU inference with verified weights, source and runner SHA; retained manifest, actual mask and timings; no reference pixels committed.
2. Manual verification of slice-axis, NIfTI RAS/affine and native CT grid against original source. Do not claim original DICOM SOP binding from NIfTI alone.
3. Expert radiologist review of proposed lesions and independently annotated public validation cohort: lesion sensitivity/FP per scan; segmentation Dice/HD95 only when voxel annotations exist.
4. Browser research import of verified mask and source-binding, independent model status, physician review and mask overlay.
5. Additional models for subtype classification (IPH/IVH/SAH/SDH/EDH) if justified with appropriate labeled data, licensing and accuracy.

Lightweight development checks: `python scripts/test-samihs-ich-public.py` (preflight only). Not a model accuracy test.
