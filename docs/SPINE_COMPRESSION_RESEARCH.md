# New spinal pathology workstream: CT vertebral body compression-deformity evidence

Original publisher: [TotalSegmentator 2.18.0](https://github.com/wasserth/TotalSegmentator/tree/v2.18.0), pinned code tag commit \`184fa4765456492b2ab81a981cc387465906b003\`. The upstream \`totalseg_spine_report\` runs original pretrained anatomical vertebra models (\`vertebrae_pp_refined\`) and calculates vertebral body heights and attenuation. This is an **anatomy-plus-morphometry research triage**, NOT an independently trained lesion-specific fracture classifier.

## Added code, not just catalog metadata

\`scripts/real-spine-vertebral-compression-report.py\` invokes the real installed vendor \`totalseg_spine_report\` binary on one **public, licensed, de-identified** CT NIfTI via an isolated, high-memory Linux worker. It neither downloads nor executes weights when used as a library import or technical CI test.

Real execution must include:
- TotalSegmentator **exactly 2.18.0** and the original compatible pretrained vertebral models.
- Original complete public CT source in exact physical-mm NIfTI coordinates, not pre-windowed PNG.
- Successful vendor report JSON, output NIfTI, and the **actual** \`totalseg_vertebrae_pp_refined.nii.gz\` volume.
- Physical-grid source-vendor segmentation agreement, with matching dimensions, affine, label map.
- L1–L5 / T1–T12 vertebral height differences and attenuation measurements when present.
- Per-vertebra original-voxel bounding boxes, study and output SHA256; numeric report only.
- Real candidate criterion height difference **strictly greater than 20%**, per publisher. Missing measurements are missing evidence, not negative findings.

All original images, model masks, logs, model cache and upstream metadata are deleted with the temporary execution folder. We deliberately do not attach source CT, original patient tags, DICOM identifiers or screenshots as CI artifacts. Disable network in real-patient product modes (they remain blocked).

## Isolated runtime

Use an authorized *Linux CPU/GPU research worker with >=12 GiB free RAM*, not user's Mac M1/8 GiB. This RAM lower bound is an admission guard, **not verified peak usage**. Install pinned original TotalSegmentator 2.18.0 with its dependencies, including SciPy and nibabel, on the worker, and verify licensing of downloaded task checkpoints separately.

Example with existing ethically usable original licensed public NIfTI source:

\`\`\`bash
python scripts/real-spine-vertebral-compression-report.py \
  --ct /scratch/licensed-original-CT/ct.nii.gz \
  --output /scratch/spine-research-numeric.json \
  --source-license 'CC BY 3.0' \
  --source-url 'https://www.cancerimagingarchive.net/collection/lctsc/' \
  --public-research-consent
\`\`\`

Do NOT use fabricated metadata, private patient CT or clinical care files. Vendor's own model downloads are not yet SHA-pinned by this wrapper. Source license applies to the image, not automatically to vendor checkpoint rights.

## Clinical evidence boundary

- Spine anatomical models and supplier code: **published upstream**, true publisher checkpoints required at actual execution.
- Research adapter, level-localization and verified physical-grid enforcement: **implemented**.
- Real external pretrained model inference on the newly added spine task in Opus: **NOT VERIFIED**.
- Original expert fracture/Genant grades with matched study IDs: **NOT OBTAINED**.
- Lesion-level accuracy, fracture sensitivity, FP/scan, clinical differentiation of compression fracture vs tumor vs chronic degenerative changes: **NOT VERIFIED**.
- Mac RAM and browser clinical UI integration: **NOT VERIFIED**.
- Patient-enabled / remote inference: **NO**.

Do not call a 20%-height-loss candidate a confirmed fracture. Separate a morphology flag from osteoporosis, malignant compression, and normal developmental variants. The next gate must be one real public CT with actual vendor pretrained execution, anatomical segmentation and height-difference metrics, then a separate case with independent expert fracture grading. Until then preserve a provisional/candidate registry state.
