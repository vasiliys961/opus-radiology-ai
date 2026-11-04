# Blind ten-X-ray VLM comparison (research only)

This experiment leaves the main clinical application unchanged.

## Design
- Same ten public, deidentified chest X-ray PNG/JPEG files, same fixed prompt.
- Gemini describes all ten images as JSON, then Nemotron describes the same ten.
- Opus judges **both sets of ten JSON descriptions in one blinded request**, with per-case preferences and a package-level summary.
- The judge **does not see the images**, so its scores measure report-writing quality, not diagnostic accuracy. Compare against independent image-level reference annotations before claiming clinical superiority.
- Original images, outputs and API keys must stay out of Git.

## Setup
Provide `OPENROUTER_API_KEY` in the environment. Supported configurable model IDs:
`MODEL_A` (default `google/gemini-3.8-flash`),
`MODEL_B` (default `nvidia/nemotron-3.5-super-vl`),
`JUDGE_MODEL` (default `anthropic/claude-opus-5.5`).
Check access and model availability on OpenRouter before running; IDs may change.

A manifest alongside the image files, **not committed**, must contain exactly ten records:
```json
[
  {"id":"case01","path":"case01.png","cloud_transfer_allowed":true},
  {"id":"case02","path":"case02.png","cloud_transfer_allowed":true}
]
```
Add eight more records for a total of 10. Set cloud_transfer_allowed=true only when the source license permits transfer to the relevant API providers. Dataset terms, de-identification, and provenance must be checked separately.

## Run locally
```bash
python3 experiments/vlm_blind_10.py --manifest /path/to/private/manifest.json --out /path/to/private/report.json
```

Requires only Python standard library. It makes **21 billable OpenRouter calls** (10+10+1). It does not automatically call APIs from GitHub Actions because a secret existing in GitHub is not proof of permission to transmit arbitrary medical data.

For use in GitHub Actions, a separate explicitly reviewed workflow and permitted sample images are needed. Do not print JSON descriptions or patient data to public workflow logs.

## Important limitations
This is a pilot of report quality, not an accuracy benchmark. A blinded text-only Opus judge can favor a fluent hallucination. Reliable evaluation requires case-wise clinical ground truth and an independent reading of the original image; assess sensitivity, false negatives and false positives, preferably by a radiologist. No 3D DICOM study can be inferred from one screenshot.
