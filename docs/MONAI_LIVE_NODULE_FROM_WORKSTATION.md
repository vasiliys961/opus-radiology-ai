# Live MONAI lung nodule detection from the physician workstation

**Physician-visible improvement**: A user can open an existing original
uncompressed HU NIfTI of a **lawfully approved public CT** inside the main
Opus Radiology AI workstation, choose **Анализировать эту КТ настоящим MONAI**,
and receive fresh candidates on the actual NIfTI slices. No manual
`monai.bundle run` or copying a separately generated JSON into the viewer.

## What actually executes

The isolated Linux CPU worker `services/imaging-ai/monai_nodule_public_worker.py`
calls the existing, genuinely pretrained
`services/imaging-ai/monai_bound_nodule.py` runner. It runs the publisher's
original MONAI RetinaNet 0.6.9 bundle (revision
`7226a40a4c3713f7d5469559b7f2fc296fd54825`), verifies model.pt
SHA-256 `b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01`
and checks the original source's NIfTI SHA-256 and physical geometry.
Original full-CT inference uses a bounded 192×192×80 CPU sliding window; this
**differs from the publisher's 512×512×192 reference evaluation settings**.
Model output is always an unverified research candidate, not a diagnosis.
No empty result can establish that no lung nodule exists.

The worker is opt-in and runs `127.0.0.1:8767` only. Browser sends the SHA-256
of the **currently opened NIfTI**, not the pixel data; the identical original
CT must already be independently provisioned on the private Linux machine.
It also requires an approved public research admission manifest (see existing
`docs/MONAI_BOUND_NODULE_CT.md`) and original MONAI bundle files. Explicit
data-policy and official checkpoint checks are enforced before every run.
This version is NOT a clinical/patient DICOM service.

## Linux deployment (example)

Install the original MONAI, Torch and Python package requirements described in
`services/imaging-ai/requirements-monai.txt` in a dedicated isolated virtual
environment. Have at least **9 GiB of available RAM** for the original runner
and enough scratch space. Acquire the original publisher bundle and verify
rights/asset SHA before use.

```bash
export OPUS_MONAI_NODULE_WORKER_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(40))')"
python services/imaging-ai/monai_nodule_public_worker.py \
  --source /approved-public/ct-source.nii \
  --admission /approved-public/ct-admission.json \
  --bundle /verified-original-monai-bundle \
  --origin http://localhost:3000 --port 8767
```

For a deployed HTTPS UI, configure `--origin` with its **exact** HTTPS
origin; never use a wildcard. To use a separate Linux research machine,
establish an authenticated SSH localhost port forward, not a public
network listener. The server exposes capabilities, submit/poll, result
and delete. A random session token and one-job-at-a-time limit apply.

In the browser's main page, upload the source `.nii` file, select it, enter
the local worker address and token, confirm its approved public-study identity,
then click the analysis button. After the real model succeeds, click candidates
to jump to corresponding original slices. No manually prepared report JSON is
required; that remains as an optional offline import.


## Reader assessment on real model candidates

The physician can now open each model candidate on the original NIfTI axial
slice and mark it **«Подозрительный · проверить»**, **«Отклонить кандидата»**
or leave it **unreviewed**. This classification pertains only to the displayed
model candidates; even if all are rejected, it does not establish a normal CT.
A source-SHA-bound local unsigned reader review is downloadable as JSON,
containing the exact model checkpoint digest, score, proposed mm coordinates,
reader decisions, unresolved counts and explicit clinical limitations.
No original CT pixels, names, network requests or stored credentials are part
of this export. Reader assessment does not establish histology, malignancy or
independent source-coordinate accuracy.

## Limits not hidden by successful CI

- **No arbitrary DICOM series support yet.** This only operates on an existing
  original HU NIfTI previously exported lawfully, not on a new unknown DICOM
  or raw patient upload.
- The current original MONAI coordinate projection is still marked as an
  **unverified model-world-to-source hypothesis**, not independently accepted
  DICOM SOP binding; the UI explicitly requires physician image verification.
- Training overlap with public LUNA16 and independent lesion FROC/recall,
  false positives per scan and clinical safety remain unresolved.
- Contract CI executes the real FastAPI request lifecycle with synthetic files
  and stubs. It does **not** run a real pretrained forward in that CI step;
  earlier genuine publisher model forwards are documented separately.
- Browser source CT data remain local; source hashes and model output stay on
  the private worker/browser. No external LLM cloud request is enabled.
