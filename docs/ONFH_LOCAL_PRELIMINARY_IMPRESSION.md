# Local ONFH (research-only) pretrained MRI classifier

The trained weights are available from GitHub Actions successful workflow **39658605661**, artifact **actual-trained-onfh-research-npz**, saved as **onfh-research-v1.npz**. This artifact is a genuine locally trained JLU cohort subject-level logistic regression, **not** a validated ONFH detector. The 24 KB checkpoint fits CPU/Mac M1 8 GB.

Download the artifact from the Actions run, extract .npz locally, compute its SHA-256 with shasum -a 256, and run:

python3 scripts/infer-real-jlu-onfh-local.py \
  --subject-png-dir /path/to/deidentified/original-style/MR-PNG-study \
  --weights /path/to/onfh-research-v1.npz \
  --weights-sha256 YOUR_ACTUAL_SHA256 \
  --report /path/to/new-onfh-report.json

This accepts an **MRI PNG slice folder**, not arbitrary DICOM, CT, NIfTI, or mixed-sequence scans. It processes locally and outputs a clinical-style preliminary interpretation plus score, clear caveats, and no images. Report is not a validated diagnosis; external data, provenance, and MR sequence suitability remain physician responsibilities. Never treat a subthreshold score as excluding AVN.

Internal split: 108 train / 35 holdout, 8 TP / 3 FN / 2 FP / 22 TN, study AUC 0.931818. This small author-internal holdout is **not** independent clinical validation. Score is not a calibrated clinical probability.

## Clinical Lab integration (local developer workstation)

Install Python `numpy` and `pillow`, download the original trained NPZ from run 39658605661, then start the web development server with `OPUS_ONFH_WEIGHTS_PATH=/absolute/path/onfh-research-v1.npz` and `OPUS_ONFH_WEIGHTS_SHA256=<actual 64-character SHA256>` in its environment. Visit `http://localhost:3000/clinical-lab` and select 2–300 PNG slices from one deidentified MR study. The browser sends images only to the *locally running Next.js server* at loopback, which calls the local Python model and deletes temporary images; DO NOT expose this dev server or proxy it publicly. Production/nonlocal requests are refused. No integration with currently viewed DICOM/MPR source or automatic conversion is claimed. Outputs remain preliminary physician-reviewed impressions.
