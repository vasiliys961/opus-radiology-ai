# Cervical fracture: C1-C7 model-score evidence and native CT anatomy

## Genuine candidate model identified; full inference not yet completed

[Original RSNA 2022 3rd-place Darragh model source](https://github.com/darraghdog/RSNA22) and [multi-model independent-external evaluation collection](https://github.com/zxjasonhu/cspine-2022-challenge-inference-collection) publish original trained weight acquisition URLs, including [the 3rd-place model asset on Kaggle](https://www.kaggle.com/models/zixuanh/cspine-3rd-place-solution-model-weights).

The 2024 *Radiology: Artificial Intelligence* external evaluation reports **AUC 0.90 for external noncontrast CT and 0.92 for external contrast CT**, based on this 3rd-place model-family benchmark. These are **source-published estimates**, not reproduced or calibrated by Opus. Original source: https://pubs.rsna.org/doi/10.1148/ryai.230550 . The original Darragh inference pipeline includes a slice-level localisation/bounding-box stage and 2.5D CNN/RNN study-level C1-C7 outputs; a scalar score for each level does not locate a cortical fracture line.

The baseline weight packages have *not been downloaded or hashed in this PR* and **no authentic forward pass in Opus** is claimed. Actual Kaggle availability/authentication/weight licensing must be checked before reuse. Original RSNA images are **competition data restricted to noncommercial research**, as stated at https://www.kaggle.com/c/rsna-2022-cervical-spine-fracture-detection/rules .

## New working medical function

The executable \`scripts/real-rsna-cspine-c1c7-evidence.py\` consumes all four **offline, separately generated** inputs:

1. An authorized original deidentified **CT NIfTI** in real RAS physical-mm coordinates, source SHA-256.
2. A source-grid matched pretrained **TotalSegmentator 2.18.0 CT \`total\`** anatomical labelmap containing C1=50, C2=49, C3=48, C4=47, C5=46, C6=45, C7=44 (confirmed against original \`totalsegmentator/map_to_binary.py\` tag v2.18.0). The **official RSNA reference segmentation instead labels C1–C7 as 1–7**, with different axis orientation: never interchange the two.
3. The full set of locally acquired **original Darragh pretrained model asset files**, with relative path, byte lengths and each actual SHA-256, verified locally against a bounded \`weights.json\` manifest. The manifest is operator-supplied; it is **NOT authoritative vendor provenance**.
4. The separate genuine Darragh inference output converted into a **strict numerical score contract**. Opus verifies source hash, manifest digest, C1–C7 and patient score, and writes a numeric source-bound 3D report. The wrapper does **NOT run the original model** and a manually prepared JSON is not an attestation of a real model run.

This creates a research-only evidence record with seven separate model scores and **actual CT anatomical** C1–C7 world-space centroids, volume and voxel bounding boxes. Scores are uncalibrated model scores, not individual positive predictive values; the anatomy boxes are not fracture-line localization. A missing level causes a hard refusal; no inference about absence of fracture.

### JSON from original model after vendor inference

Create \`original_scores.json\` **only after genuine external offline model inference**. Replace every placeholder below with actual measurements and SHA-256 hashes. The score values shown are a **format example only**; they are not real predictions:

\`\`\`json
{
  "schema": "opus-rsna2022-original-output/v1",
  "sourceCTSHA256": "<actual 64 lowercase hex digest>",
  "weightsManifestSHA256": "<actual manifest file SHA-256>",
  "model": "rsna2022-darragh-3rd",
  "scores": {
    "patient_overall": 0.0,
    "C1": 0.0, "C2": 0.0, "C3": 0.0, "C4": 0.0,
    "C5": 0.0, "C6": 0.0, "C7": 0.0
  }
}
\`\`\`

The values above are dummy zeros demonstrating the required input structure only. The original published inference script may return a CSV whose column names and order must be verified; do not assume that an arbitrary CSV was produced by the genuine model. The external adapter must perform the correct DICOM-series preprocessing, original model forward, score extraction, NIfTI→DICOM geometry registration and publisher weight verification separately.

Run **after** legally authorizing input studies and producing true model results:

\`\`\`bash
python scripts/real-rsna-cspine-c1c7-evidence.py \
  --public-ct /research/rsna/approved_ct.nii.gz \
  --totalseg-total-mask /research/rsna/total_labels.nii.gz \
  --model-predictions /research/rsna/original_scores.json \
  --model-weights-dir /research/checkpoints/darragh \
  --model-weights-manifest /research/checkpoints/weights.json \
  --output /research/reports/c1c7_numeric.json \
  --authorized-deidentified-RSNA-research-only
\`\`\`

No DICOM UIDs, radiologist names, CT pixels, masks, private paths or patient-level cloud calls are emitted; SHA hashes, model scores and spatial numeric bounds only. The NIfTI CT/segmentation still require accurate registration to original DICOM for interactive lesion navigation. The new code **does not** enable a clinical DICOM/SOP-highlighted fracture line. It does not run on the 8GiB Mac by default.

## Acceptance gates still open

- Obtain *real* original Kaggle model weights and independently record original checkpoint SHA256 / license.
- Reproduce the **true Darragh third-place model**, with real noncommercial deidentified full cervical CT in a secure GPU worker and original preprocessing; record original source bytes and model output.
- Reconcile official original DICOM slice geometry and CT→TotalSegmentator masks; confirm output score corresponds to original study. Use independent fracture reference localization.
- Measure patient and per-C1–C7 false positives, false negatives, sensitivity, specificity / AUC on a **disjoint** public or authorized research holdout. Model AUC 0.90/0.92 is a reported external result, not our holdout.
- Original 3rd-place model code indicated GPU requirements well beyond Mac M1/8GiB; isolate a separate high-VRAM GPU executor. No patient mode or provider API without medical and data-protection approval.

Next action: true checkpoint acquisition, safe container/legacy code setup, **real external model forward** and expert-heldout benchmarking; never promote postprocessor CI as actual detection.
