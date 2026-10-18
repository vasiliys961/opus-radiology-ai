# Task 315: real pleural/pericardial effusion model execution (research only)

This increment closes the missing execution-to-Evidence bridge for a **separately
installed official pretrained** TotalSegmentator 2.18.0 `pleural_pericard_effusion`
checkpoint. Code path:
`services/imaging-ai/effusion_inference.py` -> official Python API
`totalsegmentator(... task="pleural_pericard_effusion", ml=True, device="cpu")`
-> original single multilabel NIfTI mask
-> existing `effusion_source_evidence.run` native source-grid proof
-> output `opus-real-task315-effusion-execution/v1` with embedded
`opus-real-totalseg-ct-effusion-source-proposals/v1`.

**No pretrained weights are stored in this repository or automatically
downloaded by Opus. No real task315 inference or clinical accuracy is claimed
merely by CI passing.** Inference requires preprovisioned weights, actual
authorized full source HU CT, measured adequate host RAM, pinned package 2.18.0
and an external Linux CPU sandbox with OS network isolation and resource limits.
The minimum observed free RAM admission is 10 GiB; do not run this heavy model
on the user's Mac M1/8GB. Never send real patient data to Actions.

Example of a source admission file, held privately next to legally obtained
research CT, **not** an automated validation of author identity or consent:

```json
{
 "schema":"opus-public-ct-task315-admission/v1",
 "sourceSha256":"<64 lowercase hex of full original HU .nii>",
 "modality":"CT",
 "pixelIntensity":"verified-original-HU",
 "fullAcquisitionCoverageVerified":true,
 "publicOrRightsClearedResearchData":true,
 "notRealPatientData":true,
 "originalImageLicenseReviewed":true
}
```

The operator uses `--source`, `--output-mask` (.nii.gz),
`--output-json`, `--checkpoint`, `--checkpoint-sha256`,
`--source-admission`, and
`--authorization PUBLIC-CT-RESEARCH-TASK315-OK`.

Keep the output new. If model inference fails, geometry differs by >0.05 mm,
or labels include unknown values, neither mask nor JSON is retained.
Classes: **1 = lung_pleural, anatomical**, **2 = pleural_effusion**,
**3 = pericardial_effusion**. Label 1 never contributes to fluid volume.
Class 2 or 3 absent does **not** mean no effusion. Clinical Dice,
specificity and lesion sensitivity remain null.

The model-generated Evidence may be imported using the existing
`/viewer` -> **Pleural/pericardial effusion research** JSON importer.
The input is a research NIfTI, not automatically tied to the currently
opened DICOM: it cannot produce a source-SOP diagnostic overlay without
independent DICOM pixel/frame binding. To match the accepted importer
schema, extract the nested `evidence` object into its own JSON file.
This report has a claimed execution chain but no cryptographic proof that
TotalSegmentator internally selected the supplied checkpoint path:
the CLI hashes the separately supplied preinstalled file and expressly
sets `activeWeightsCryptographicallyProven:false`.

## Scope of tests

`services/imaging-ai/test_effusion_inference.py` runs a fake infer callable
on mathematical CT/masks, verifies task 315 invocation, labels, source geometry,
empty-mask nondiagnostic behavior, admission and cleanup. **No trained checkpoint
or patient CT is executed in CI.**

Upstream: https://github.com/wasserth/TotalSegmentator
task `pleural_pericard_effusion` (Apache 2.0 research model, limited training
data; not a medical device). License and source dataset rights remain separate.
