# Original CXR TorchXRayVision: one-click DICOM (research, nonpatient only)

## What actually works

Original published **NIH DenseNet121** (\`torchxrayvision==1.5.7\`) runs ONCE on a
source PNG derived locally from a single original CR/DX DICOM of the CHEST,
then returns **six** image-level scores: Pneumothorax, Cardiomegaly,
Effusion, Pneumonia, Edema and Mass. Six classifiers are NOT installed;
these are six heads of the same pretrained checkpoint.

- Published SHA-256 checkpoint pinned to
  \`31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf\`.
- Original source raster is SHA-256 bound all the way browser -> same-origin
  Next.js proxy -> local Linux worker -> verified published research runner.
- No untrusted weight paths, model labels, patient DICOM, source URL, worker
  token or de-identification metadata are returned to browser from the server.
- Existing true published-model inference on an NIH public PNG is documented
  in \`.github/workflows/xrv-pneumothorax-original.yml\`. **This new original
  DICOM -> worker route is not yet independently tested on a real public
  DICOM acquired as CR/DX.**
- Only original uncompressed single-frame MONOCHROME1/2 8- or 16-bit
  DICOM is supported by the local pixel preview used to derive PNG. Compressed
  or multi-frame radiography must report unavailable, not be guessed.
- Technical SHA and image-model readiness do NOT establish real-life
  clinical accuracy or generalizability. Scores are NOT calibrated disease
  probabilities and have NO spatial localization.
- CXR is a 2D modality. CT/MRI 3D detector routing is not reused.
- Clinical or patient interpretation is BLOCKED in this research-only worker.

## One-time research operator setup on private Linux

Install dependencies once on isolated host (they are not installed in
the browser or on an M1 with 8GB RAM):

\`\`\`sh
python -m pip install "torch==2.6.0" "torchvision==0.21.0" \
  --index-url https://download.pytorch.org/whl/cpu
python -m pip install "torchxrayvision==1.5.7" \
  "scikit-image" "fastapi" "uvicorn"
python scripts/start_xrv_research_worker.py
\`\`\`

First startup downloads the exact official publisher checkpoint over HTTPS,
checks byte count and SHA-256, and caches it immutably under
\`~/.cache/opus-radiology/original-models/xrv/\`.
A second startup rechecks exact cached bytes without downloading again.
The bootstrap writes one random shared secret to ignored private
\`web/.env.local\` with mode 0600, not to GitHub. It starts the original
localhost-only Linux worker on \`127.0.0.1:8779\`; run it as a supervised
persistent service on the same machine as Next. Restart Next once after
first-time setup so the server loads the secret; no keys, paths or terminal
commands are needed **in the physician's DICOM viewer**.

The lightweight readiness GET on \`/api/local-xrv\` checks an actual worker
capability response: exact original release/version/SHA and model availability.
An unavailable original checkpoint shows NOT READY, never success or
"negative radiograph". Next accepts public-source PNG only from a same-origin
localhost browser in development, forwards with its private secret, and
never exposes the internal worker token. Do not expose Next development or
this worker to the public internet. Production requires operator login,
session-based patient authorization and a separate licensing/privacy review.

## Existing optional Yandex Disk (1 TB) cache

The repository ALREADY HAS \`scripts/yandex_model_weights.py\` providing a
bounded, SHA-verified authenticated Yandex Disk model archive downloader.
No new OAuth scopes or login are needed for code changes. You only need
Yandex access when actually fetching YOUR private model archive.

To use it, upload the official weight file to
\`disk:/opus-models/xrv/<original-weight-file>\`, then create a **private**
manifest file with:
\`\`\`json
{
  "modelId": "densenet121-res224-nih",
  "diskPath": "disk:/opus-models/xrv/nih-densenet121-d121-tw-lr001-rot45-tr15-sc15-seed0-best.pt",
  "sha256": "31a5475c6b1383a7edbfcaf96af9ce302eb9969cfe28b6b8b5859afc6f274fdf",
  "sizeBytes": 0
}
\`\`\`
**Replace \`sizeBytes: 0\` with the actual original verified checkpoint file
size before use** (the downloader rejects missing/zero/guessed sizes).
\`\`\`sh
export YANDEX_DISK_TOKEN="<private-OAuth-secret>"
python scripts/start_xrv_research_worker.py --yandex-manifest /private/xrv-model.json
\`\`\`
Never paste secrets into the chat or upload them into GitHub. We can use
the official publisher fallback immediately without access to your Yandex
account.

## Independent Gemini Vision, then Opus

**Important:** The six CXR scores are now connected to the research DICOM
viewer, but independent CXR Gemini Vision → Opus is a separate next
integration: existing privacy-reviewed vision pipeline is still CT/MR only.
Do not send scores as if they were a confirmed diagnosis, invent projection
PA/AP, cardiothoracic ratio or any image localization. The planned prompt
requires independent image-only Gemini review FIRST, including projection
and magnification limitations; only AFTER that should Opus compare numeric
NIH scores to Gemini observations and prepare an unsigned physician draft.

Any genuine deployment still needs an authorized real public CR/DX DICOM
end-to-end trial and separate clinical validation before patient use.
