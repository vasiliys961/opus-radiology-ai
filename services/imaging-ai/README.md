# Opus Imaging AI Engine — dependency profiles and installation

**State as of 2026-10-11:** this directory currently contains proposed runtime dependency profiles only. The authenticated Python HTTP AI Worker and browser one-click integration are **not yet implemented**. The proven standalone real CPU ONNX runner is \`scripts/run-local-onnx.py\`, tested with synthetic weights. Medical pretrained checkpoints are not packaged.

[Canonical roadmap](../../docs/OPUS_RADIOLOGY_MASTER_SPEC.md) · [Acceptance requirements](../../REQUIREMENTS.md) · [Existing ONNX usage](../../docs/LOCAL_ONNX_AI.md)

## A. Minimal Mac M1 (8 GiB) / offline ONNX CPU

Install **native arm64 Python 3.11 or 3.12**, create a NEW isolated environment and leave the Next.js project untouched:

\`\`\`bash
cd "$HOME/Desktop/opus-radiology-ai-github"
python3.11 -m venv .venv-imaging-base
source .venv-imaging-base/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
python -m pip check
python -c "import onnxruntime as rt; print('ONNX providers:',rt.get_available_providers())"
\`\`\`

If \`python3.11\` is unavailable, use an installed native Python 3.12 (\`python3.12\`). This installs only the minimal ONNX/NIfTI/DICOM/FastAPI packages. It does NOT install Lungmask, TotalSegmentator, MONAI, PyTorch or a real model, and FastAPI endpoint creation is a separate future milestone.

To validate the shipped real ONNX runner with an independently supplied **compatible** checkpoint, see \`docs/LOCAL_ONNX_AI.md\`. **Never use synthetic test checkpoint outputs as clinical evidence.**

## B. Mac M1 — optional Lungmask

Use a **separate** venv; do not inflate the 8 GiB ONNX-only environment:

\`\`\`bash
cd "$HOME/Desktop/opus-radiology-ai-github"
python3.11 -m venv .venv-lungmask
source .venv-lungmask/bin/activate
python -m pip install --upgrade pip
python -m pip install -r services/imaging-ai/requirements-lungmask.txt
python -m pip check
\`\`\`

The package's own CLI or future Opus adapter may download model weights at first use. Verify source and weight license/checksum and limit to lawful reference CT for early testing. Use \`--batchsize 1\` if supported. No claim is made that the model works on this specific machine until benchmarked.

## C. Mac / CPU server — optional TotalSegmentator or MONAI

Install one chosen family per isolated venv:

\`\`\`bash
python -m pip install -r services/imaging-ai/requirements-totalsegmentator.txt
# or separately:
python -m pip install -r services/imaging-ai/requirements-monai.txt
\`\`\`

Official TotalSegmentator supports CT/MR, CPU, MPS on Apple Silicon, and \`--fast\`/\`--roi_subset\` resource options. Selected optional tasks or weights may have separate license restrictions. On M1/8 GiB test \`--device cpu\` and \`--device mps\` with bounded ROIs; do not assume fast mode equals original-resolution diagnostic performance.

MONAI is a toolkit, not a complete installed radiology model. Each MONAI Bundle has its own checkpoint/config/preprocessing and MUST pass the model registry gate. Some MRI tasks require multiple distinct sequences.

## D. GPU server — optional, never needed just to view DICOM

1. Provision private worker, VRAM/RAM and identity/network controls.
2. Install the **matching NVIDIA driver** and **CUDA-enabled PyTorch wheel** using the [official PyTorch guide](https://pytorch.org/get-started/locally/) (CUDA/toolchain compatibility cannot be hardcoded for all servers).
3. In a new venv: \`python -m pip install -r services/imaging-ai/requirements-server-gpu.txt\`.
4. Verify:

\`\`\`bash
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
python -m pip check
\`\`\`

The baseline includes **CPU** \`onnxruntime\`. Never install both \`onnxruntime\` and \`onnxruntime-gpu\` in a single environment. A separate CUDA ONNX venv can replace CPU ONNX after pinning compatible CUDA/cuDNN. GPU use is not authorized patient data transfer by itself; production access/privacy must be separately completed.

## E. Developer unit-test environment

\`\`\`bash
python -m pip install -r services/imaging-ai/requirements-dev.txt
python scripts/test-local-onnx.py
\`\`\`

Only synthetic NIfTI/ONNX fixtures; no download of medical weights and no external model API.

## Deployment rules

- The above \`requirements*.txt\` express **compatible version ranges**, not exact hash-locked production lock files. Before production generate platform-specific reproducible frozen dependency lock/constraints + SBOM + security audit; no automated forced upgrade of an installed clinical checkpoint.
- **Never auto-install everything** on a Mac M1. Model-specific requirements must be optional, CPU and GPU installs separated; validate memory budget before imaging workload.
- \`web/package.json\` manages JavaScript; requirements.txt never installs Next.js or Cornerstone.
- \`FastAPI\` in requirements doesn't mean a deployed API exists. Future local \`127.0.0.1\` endpoint needs origin/session authentication, local filesystem sandbox, streaming and test coverage first.
- Maintain patient-cloud fail-closed gate until authorized privacy/deidentification/security conditions have been demonstrably satisfied. Python dependencies cannot change that.
- For online providers, there may be paid usage and regional/licensing restrictions; no mandatory subscription or provider account for local core.
