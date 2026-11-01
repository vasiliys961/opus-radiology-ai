# One-command local CLN + Opus research viewer

Run the actual original CLN nnU-Net worker and the existing DICOM web viewer on one **Linux CPU host**. This is not a simulated detector or a patient-production deployment.

## Prerequisites

- Linux, at least **12 GiB currently available RAM** and **6 GiB free disk space** (16+ GiB installed RAM is recommended).
- Python 3.11, Node.js 24, `npm`.
- In the same Python environment as the launcher, install the exact packages validated by the real browser CI job:
  ```bash
  python -m pip install numpy==1.26.4 pydicom==3.0.1 nibabel==5.3.2 huggingface_hub==0.35.3 requests==2.32.3 idc-index
  python -m pip install 'torch==2.5.1+cpu' 'torchvision==0.20.1+cpu' --index-url https://download.pytorch.org/whl/cpu
  python -m pip install --extra-index-url https://download.pytorch.org/whl/cpu 'torch==2.5.1+cpu' 'torchvision==0.20.1+cpu' 'nnunetv2==2.7.0' 'numpy==1.26.4' 'psutil==7.0.0' 'fastapi==0.115.12' 'uvicorn==0.34.2' 'huggingface_hub==0.35.3' 'nibabel==5.3.2'
  python -m pip check
  cd web && npm ci && cd ..
  ```

## Startup

```bash
python scripts/start-opus-cln-app.py --check-only
python scripts/start-opus-cln-app.py
```

The second command fetches the **publisher's original** `Lab-Rasool/CLN-Segmenter-MSD-fold0` model on first use, verifies its official SHA-256, starts the private CPU worker on `127.0.0.1:8783`, and the viewer on `http://127.0.0.1:3000/viewer`. Start and stop both services in one terminal. No saved API secrets or anonymous network exposure.

For a persistent volume of original weights, choose `--model-cache /path/to/persistent/cache`. A mounted Yandex Disk location may serve as the cache, but **OAuth and mount are not configured by this launcher**. It is not a substitute for fast local storage during inference.

For the already reviewed public research-only cloud workflow:

```bash
export OPENROUTER_API_KEY='set-your-key-locally'
python scripts/start-opus-cln-app.py --enable-public-cloud
```

The launcher prints a one-session local operator token. Enter it inside the browser only after **local OCR, visual PNG review, lawful-disclosure confirmation and paid-call consent**. Gemini reviews the selected source PNGs independently; Opus receives that analysis and completed real detector evidence and generates the editable, **unsigned** Russian radiology report. The original DICOM stays local. External requests are not automatic.

**Limits:** The local launcher is for authorized research material only. It does not grant permission to process patient data, certify de-identification, prove clinical validation or run a permanent GPU server. The proof that the entire browser → original DICOM → CLN → Gemini → Opus → TXT path works must come from the separate **REAL browser** GitHub Actions job; launcher preflight is not that proof.
