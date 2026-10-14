# Bounded SAMIHS CPU research pilot — genuine pretrained model, limited real-CT slices

**Status:** executable bounded-source preparation + optional real pretrained CPU attempt.
**This CI is synthetic numerical contract testing, NOT model inference.** No actual SAMIHS
CPU result, accuracy estimate or real CT comparison is claimed until a trusted
operator has run the `--mode infer` command with public source pixels, matching
original expert mask and audited official weights.

The baseline full-case CUDA runner and its official checkpoint admission remain unchanged.

## Why this exists

The official SAMIHS package is a per-2D-slice ICH network, allowing a bounded
consecutive subset of a genuine source CT to be used as an **engineering
feasibility pilot**. The published upstream example uses CUDA; upstream CPU
compatibility, runtime and memory have **not** been demonstrated. We may try
`segment_ich.py --device cpu --batch-size 1`, with a 120–1800-second timeout
on an isolated Linux 4-core/16-GiB machine. Never imply that this makes a
full source volume processed, or that selecting the bleed-positive slab estimates
full-study diagnostic sensitivity.

The script stores every selected native pixel unchanged, moves the RAS affine
origin by the slice starting offset (not resampling), and converts the selected
original expert integer label into a binary slab. It rejects missing hemorrhage
in the selected expert ROI. This is a *derived* expert mask, not a new or
re-authored expert annotation. Both original full-size CT and expert SHA-256
are retained along with derived slab SHA-256. No original DICOM SOP mapping.

**No paid GPU or paid API.** GitHub standard `ubuntu-latest` CPU runners
may have sufficient host RAM but normal CI NEVER downloads weights or medical
data: the workflow tests only synthetic coordinate/contract fixtures. For a
*real* run use an authorized separately provisioned, isolated Linux host or
approved CPU runner where the required publicly licensed files have been
supplied legitimately. Do not store images, patient identifiers, PHI, model
weights or original expert masks in the GitHub repository/artifacts.

## Candidate research data and rights

- Zenodo: https://zenodo.org/records/8228847 — SAH NIfTI CT plus manual
  expert masks; archive approx. 648 MB; the published images are anonymized,
  **resampled, skull stripped and normalized**. These transformations may
  violate original SAMIHS input assumptions: verify before inference. Confirm
  license / author rights **for images and labels**; do not auto-download.
- Zenodo: https://zenodo.org/records/8063221 — Seg-CQ500 expert label
  masks for 51 CQ500 CTs; source CQ500 has its **own terms/EULA**, and
  publicly published labels alone do not clear copying the original CT.
- Trained source: https://huggingface.co/MooreMuaMu/samihs-ich-segmentation
  official revision `29aaa1287ca35b19e40495bd4966fa2923871cb9`,
  checkpoint SHA-256 `b4c5ff729b906605555f83359120341a72035d1b6a784a9fef7dd61ee09a639e`.
  Audit `segment_ich.py` and PyTorch pickle before deserializing.
  A model-card MIT label is not proof of all weights, data and dependency rights.

## Actual execution on an approved Linux CPU host

Compute SHA-256 for the **original unchanged** full NIfTI CT, original expert
NIfTI and audited wrapper independently, then specify a native source K-slab
containing reference hemorrhage. Never use a resized 2D PNG as quantitative
input. Output path must not exist.

```bash
python scripts/run-ich-samihs-cpu-pilot.py \
  --mode infer \
  --input /research/authorized-original-head-ct.nii.gz \
  --expert-mask /research/original-expert-mask.nii.gz \
  --source-sha256 <ORIGINAL_CT_SHA256> \
  --reference-sha256 <ORIGINAL_EXPERT_SHA256> \
  --dataset-citation-url https://zenodo.org/records/8228847 \
  --model-dir /research/audited-samihs-revision \
  --checkpoint-sha256 b4c5ff729b906605555f83359120341a72035d1b6a784a9fef7dd61ee09a639e \
  --wrapper-sha256 <AUDITED_SEGMENT_ICH_PY_SHA256> \
  --start-slice 40 --slice-count 16 --slice-axis 2 \
  --output-dir /research/new-cpu-slab-results \
  --reference-label 1 --timeout-seconds 1200 \
  --rights-attested --deidentified-public-data --upstream-model-audited \
  --authorization AUTHORIZED-PUBLIC-ICH-CPU-SLAB
```

**Start-slice 40 is only CLI syntax demonstration, NOT a verified suitable
slice from the published dataset.** Determine the actual range and ontology
from its real CT and original labels before invocation.

To prepare and verify native slab files *without* invoking the model, use
`--mode prepare` and omit `--model-dir`, checkpoint/wrapper SHA and
`--upstream-model-audited`. It produces a manifest with
`status=prepared_real_public_slab_no_model_execution`, `metrics=null` and
`model.executed=false`. NEVER call that a successful medical AI run.

On actual successful `--mode infer`, the vendor wrapper is run on *those*
native source pixels with `--device cpu`. Only after it returns a geometry-
consistent **binary NIfTI** does the script score the true expert ROI, with
Dice, IoU, HD95 (or reason missing), TP/FP/FN, volume and SHA-256. Manifest:
`opus-ich-samihs-cpu-slab.json` with
`status=trained_samihs_cpu_slab_executed_and_expert_compared`,
`fullOriginalStudyProcessed=false`, model time and hashes.

**Important:** This new pilot manifest does not imitate
`opus-ich-first-public-case-complete.json`. The latter is reserved for the
full authorized external CUDA workflow. Pilot results are NOT yet available
for the existing full-case physician import without an explicit separate
bounded-slab reviewer implementation. They must be interpreted independently
in original source K coordinates, accounting for slab offset.

No patient mode, cloud model input, external API, account charges or Mac M1
computation has been enabled. This is research infrastructure, not clinical
validation or negative diagnosis.
