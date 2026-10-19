# New heart pathology: original pretrained AI-CAC on nongated noncontrast CT

**Research-only; not a deployed clinical detector.** This adds a NEW task (coronary calcium)
instead of comparing existing lung model versions.

## Original publisher checkpoint (genuine weights, no fake fallback)

- Publisher: https://github.com/Raffi-Hagopian/AI-CAC
- Locked inspected code: \`5f33f2419d60774f8a160200a70bd057b4d61b2a\`
- Official release: \`v1.0.0\`, \`va_non_gated_ai_cac_model.pth\`
- Official URL: https://github.com/Raffi-Hagopian/AI-CAC/releases/download/v1.0.0/va_non_gated_ai_cac_model.pth
- Official GitHub release asset listed size: **1,205,817,465 bytes**.
- Upstream repository LICENSE: MIT. Clinical/commercial rights of the separately
  distributed weights require independent review; do not silently infer them from
  source-code license.
- Publisher: SwinUNETR, 2D 512x512, 1 input/output channel, feature size 96,
  DataParallel \`model_state_dict\`. The original publisher inference runs on HU images,
  thresholds raw output at \`>0\` in its scoring step and uses a 3D component calculation
  normalized by \`slice thickness / 3 mm\` with connected components of >1 voxels.
- Model release does **not** publish a separate SHA256/signature in release metadata.
  \`fetch-weights\` obtains original bytes directly from GitHub, enforces exact
  asset size and records an observed SHA256. This is a local checksum, **not**
  cryptographically authenticated vendor provenance.

## What this PR adds

\`scripts/real-ai-cac-public-ct.py\` is a separate **opt-in** research runner.
It accepts exactly one original full native axial DICOM series of a *lawfully*
reusable de-identified public research chest CT. It rejects contrast descriptions,
mixed CT series, unbounded scan sizes, mismatched SOPs, non-axial geometry,
irregular slice spacing and incorrect HU scaling. It never auto-connects to
browser, /api/ai, a hospital study, or cloud.

This executor loads actual publisher checkpoint with Torch \`weights_only=True\`,
restores the original trained DataParallel state into the identical
MONAI SwinUNETR architecture, and runs the authentic model slice-by-slice.
It emits numerically bound study/checkpoint checksums, predicted positive-mask
voxel count, publisher-style CAC surrogate score and component voxel bounding
boxes. It can optionally calculate original-native-grid TP/FP/FN/Dice against
a genuinely aligned **binary coronary calcium** expert NIfTI label in RAS
convention, rejecting unregistered masks. No raw pixels, filenames, UIDs,
identifiers, screenshots, masks or DICOM are uploaded as GitHub CI artifacts.

The numerical output intentionally says
\`notStandardECGGatedAgatstonScore: true\`. Do **not** display it as an
exact conventional ECG-gated Agatston score or use it for treatment decisions.
It does not estimate stenosis, perfusion, noncalcified plaque or cardiovascular risk.

## Run only on a separate high-memory authorized Linux worker

Not on M1/8 GB; not from the web server. Needs at least **18 GiB available RAM**
and, if CUDA used, **12 GiB free VRAM**. Those are conservative *admission
minimums*, not measured full-run peak requirements. Use a fresh isolated
environment with pinned compatible PyTorch, MONAI 1.4.0, pydicom, scipy,
numpy and nibabel. No credentials or keys are accepted.

\`\`\`bash
python scripts/real-ai-cac-public-ct.py --mode fetch-weights \
  --model-dir /scratch/opus-ai-cac-official --public-research-consent

python scripts/real-ai-cac-public-ct.py --mode infer \
  --model-dir /scratch/opus-ai-cac-official \
  --public-dicom-dir /scratch/licensed-deidentified-chest-ct/one-series \
  --output /scratch/opus-ai-cac-only-numeric.json \
  --device cuda --public-research-consent

# Optional ONLY if expert calcium mask is already independently registered to
# the exact DICOM slice (row,column,z) grid; never fake the affine:
# --expert-mask /scratch/verified-original-cac-expert.nii.gz
\`\`\`

For CPU, replace \`--device cuda\` with \`--device cpu\` on a high-RAM machine.
A public source cannot be assumed to be non-contrast from folder name alone:
scan protocol/DICOM technical validation and rights must be verified before use.
Do not pass real-world patient DICOM under the research consent flag.

## Independent expert sources to evaluate next

1. **Stanford AIMI COCA** provides non-gated chest CT with coronary calcium
   scores, and separately gated cardiac CT with lesion segmentations. Do **not**
   pretend the nongated collection automatically provides voxel masks:
   https://aimi.stanford.edu/datasets/coca-coronary-calcium-chest-ct
2. **COCASegmentations** supplies 203 expert-reviewed nongated chest CT cases
   with eight anatomy-specific calcium classes (including coronary, valve,
   aorta); annotations in NRRD correspond to COCA scans. Dataset-to-scan
   registration/rights must be checked per source:
   https://github.com/datadoc1/COCASegmentations
3. **PatchChestCT** provides patch-level *coronary calcification* labels,
   not native 512x512xN calcium voxel masks. It cannot be used for native Dice
   without a validated spatial transformation:
   https://zenodo.org/records/19707049

Do not call 203 cases an independent holdout until training overlap with the
publisher is excluded, rights reviewed, and actual metrics measured.

## Evidence/status after this increment

- Source-backed original checkpoint and release identified: **YES**
- Downloaded and SHA-observed on GPU worker: **NOT YET VERIFIED**
- Real original checkpoint inference on a public original CT: **NOT YET VERIFIED**
- Native source-bound positive lesion localized: **NOT YET VERIFIED**
- Independent public expert mask TP/FP/FN/Dice: **NOT YET VERIFIED**
- Browser MPR integration or clinician sign-off: **NO**
- Patient data/remote cloud activation: **BLOCKED**

CI in this PR intentionally runs only parser/geometry/checkpoint-rejection and
scoring contract fixtures. These are **not** real disease detection experiments.
Until the complete real inference gate succeeds, the registry status must
remain \`real_checkpoint_candidate\` or \`weights_unverified\`, never
\`real_case_measured\` or \`connected\`.
