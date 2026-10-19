# Colon cancer CT — independent pathology coverage, research-only

**Goal:** extend Opus abdomen/pelvis beyond pancreas, liver and kidney to
**primary colorectal cancer**. MONAI VISTA3D pretrained label **27**, called
"colon cancer primaries", is not the general colon-organ segmentation label 62.

- **Original model:** [MONAI/vista3d](https://huggingface.co/MONAI/vista3d),
  immutable publisher revision resolved from prefix `c6dbe15`.
  The original 872 MB \`models/model.pt\` and official publisher inference
  \`configs/inference.json\` + \`scripts/\` are fetched to a temporary research
  directory. Official CUDA model loading is intentionally isolated and opt-in.
  SHA256 of the actual bytes is recorded **at download and checked again before
  actual execution**. No checkpoint is committed.
- **License:** original bundle code Apache-2.0, **weights NVIDIA License
  noncommercial research/evaluation only**. Not authorized for commercial
  clinical use. This is stricter than treating all MONAI weights as Apache-2.0.
- **Public source:** [MedOtter/msd-colon](https://huggingface.co/datasets/MedOtter/msd-colon),
  original MSD Task10 Colon CT/labels under published CC BY-SA 4.0 dataset card.
  HF revision starting \`59253d1\` is resolved to 40-character SHA; source
  image/label hash recorded. This repository is a rehost: provenance and reuse
  require further review for any deployment.
- **Original expert labels:** binary tumor mask; not an organ mask.
- **Actual inference protocol:** MONAI publisher config; input dict contains
  ONLY original CT path and \`label_prompt:[27]\`. Config preserves the
  publisher's resampling, inversion to original geometry and output.
- **Evaluation:** requires an actual executed checkpoint, authentic output
  path and SHA, matching source shape and NIfTI affine, allowed tumor values
  \`0,27\`; compute true voxel TP/FP/FN, Dice, precision, recall, and
  connected lesion candidates with native voxel bounds. Neither zero tumor
  voxels nor failure is interpreted as healthy CT.
- **No independence claims:** chosen expert-positive original CT originates
  from the Task10 training pool and **may overlap checkpoint training**.
  Voxel Dice is descriptive, not external sensitivity/clinical validation.
  Study → source DICOM SOP localization remains unfinished.

## Commands / execution

\`\`\`bash
# Only in a separate CUDA GPU research environment (>=14 GiB VRAM)
python3 -m pip install 'monai[ignite]==1.5.0' 'huggingface_hub>=0.26,<2' \
  'nibabel>=5.2,<6' 'numpy>=1.26,<3' 'scipy>=1.12,<2'
python3 scripts/real-public-msd-colon-vista3d.py --mode all \
  --work /tmp/opus-vista3d-colon-research --report /tmp/colon-numeric.json
\`\`\`

The workflow \`.github/workflows/real-msd-colon-vista3d.yml\` runs
**CPU-only contract checks** for all PRs. Genuine inference is an explicit
\`workflow_dispatch\` with \`run_gpu=true\` on a separately configured
self-hosted \`gpu\` runner, not automatically available in standard GitHub
Actions. A green contract CI is **not** a successful trained inference.
No GPU run, expert Dice or clinician-reviewed pathology is claimed until
a genuine numeric output is independently inspected.

Not connected to the production web patient pathway, and no private
DICOM/cloud upload introduced. Local Mac M1/8GB is not targeted by this
872MB checkpoint workflow.
