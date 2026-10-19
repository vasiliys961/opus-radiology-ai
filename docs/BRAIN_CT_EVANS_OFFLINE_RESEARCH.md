# NEW CT brain clinical task: Evans index / ventriculomegaly review candidates

## Genuine vendor-trained anatomical models, rather than an invented pathology detector

The [TotalSegmentator 2.18.0 official Evans index utility](https://github.com/wasserth/TotalSegmentator/blob/v2.18.0/totalsegmentator/bin/totalseg_evans_index.py) invokes genuine pretrained **brain/skull** segmentation and dedicated **ventricle_parts** segmentation, then rigidly registers the patient CT to the bundled brain atlas, approximates the inner skull diameter using dilated brain and calculates the frontal-horn Evans ratio. Vendor output: \`evans_index\`, \`brain_volume_ml\`, \`ventricle_volume_ml\`, \`ventricle_brain_ratio\`. This pipeline is a research tool and is **not** itself a trained hydrocephalus diagnosis model. An Evans index >= 0.30 is a **review candidate** only.

Official implementation: https://github.com/wasserth/TotalSegmentator/tree/v2.18.0 and method https://github.com/wasserth/TotalSegmentator/blob/v2.18.0/resources/evans_index.md. Vendor's generated PNG is an atlas-based preview, not verified original DICOM/SOP coordinate evidence; the new code deliberately does not publish it.

## New actual-execution route (opt-in separate Linux worker)

\`scripts/real-head-ct-evans-offline.py\` invokes the actual vendor \`totalseg_evans_index\` binary *inside an independently built digest-pinned OCI container*, with **network disabled, no privilege escalation, read-only root, no Linux capabilities**, bounded memory and process count, read-only mounted original CT and verified installed checkpoint files. It refuses to run on macOS / the user's 8GiB Mac. The preinstalled image must contain TotalSegmentator **2.18.0**, its atlas, and runtime dependencies (\`antspyx\`, \`blosc\`, \`nibabel\`, \`numpy\`, \`scipy\`, \`matplotlib\`, and compatible PyTorch/nnU-Net). The model cache must be mounted externally; do not download weights in the worker. External checkpoint assets may have separate license terms from the code.

Operator must independently provision:
- A rights-cleared, deidentified, original public full CT head NIfTI in millimetres (no real patients).
- A local model cache containing **actual original** trained TotalSegmentator models for \`total\` brain/skull ROI and \`ventricle_parts\`. The specified model paths and SHA-256 hashes must be listed in a local \`weights.json\` manifest.
- A prebuilt research-only container with **immutable sha256 digest**, verified version and all pretrained runtime dependencies; model assets live outside git; **no pull** by the execution script.
- Host with sufficiently large RAM/CPU/GPU; docker allocation is limited to 24GiB, temp storage 8GiB. Peak memory and completion time are not proven.

Example only — DO NOT treat placeholders below as real checkpoint signatures or a successful execution:

    python scripts/real-head-ct-evans-offline.py \
      --ct /data/approved/deidentified-original-CT-head.nii.gz \
      --weights-dir /private/research/totalseg-pinned-models \
      --weights-manifest /private/research/weights.json \
      --executor-image 'localresearch/totalseg-evans@sha256:<ACTUAL_64_HEX_IMAGE_DIGEST>' \
      --output /data/approved/evans-numeric.json \
      --source-license 'CC BY 4.0' \
      --source-url 'https://<ACTUAL_ALLOWED_PUBLIC_CT_SOURCE>' \
      --approved-deidentified-public-head-CT-only

The JSON manifest has the form \`{"files":[{"path":"<relative model file path>","sha256":"<actual sha256>"}, ...]}\` with **>=2** physically present pretrained assets from the two required model families. The executor checks actual local file bytes against these values; **the owner-supplied manifest alone does not authenticate the publisher**. A future step must independently pin original published weights/model IDs.

The output contains only hashes, source shape/spacing, weights bytes sizes/digests, original vendor Evans ratio and brain/ventricle volumes, no CT image, DICOM UID, raw pixel, expert identifier or PNG. Failed vendor runs do not publish stderr/stdout, which could contain paths or PHI. Actual case-specific radiologist review must inspect the vendor native output locally and ensure atlas registration validity.

## Strict clinical boundary

- Elevated Evans ratio may indicate **ventricular enlargement**, not determine etiology (normal pressure hydrocephalus vs ex vacuo atrophy vs obstruction and others).
- The original vendor calculation uses an atlas-registered dilated brain as surrogate for inner skull, not a directly independently verified DICOM clinical caliper; do not claim its endpoints are source-voxel spatially linked.
- Below 0.30 does not rule out hydrocephalus, especially normal-pressure cases.
- Missing brain, misregistration, motion, pediatric/partial studies and postsurgical changes must be excluded or separately reviewed.
- **No true public positive full CT inference or original checkpoint SHA verification has been performed in this PR.** The CI covers synthetic numeric/manifest safety contracts, not pathology detection, sensitivity or specificity.
- Model training source/data overlap must be checked before independent evaluation.
- **Patient use and remote LLM remain disabled**. The isolated worker cannot access network.

## Next

Acquire independently licensed brain/ventricle model checkpoint provenance, build a reproducible pinned container, run one lawful positive public adult head CT with expert ventricular measurements and review registration, then use independent studies and compare vendor index, sensitivity for ventriculomegaly and failure rate.
