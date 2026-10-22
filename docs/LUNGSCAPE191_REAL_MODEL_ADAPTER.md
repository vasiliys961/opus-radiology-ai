# LungSCAPE Dataset191 — actual pretrained research inference (opt-in)

**Status: adapter source implemented; pretrained weights NOT installed by this PR and no actual CT inference has been executed by this PR.**

Reference model: https://zenodo.org/records/18860414 — official `Dataset191_HighAttenuation.zip` (~1.2 GB, MD5 published by author `14d9d057b79d45e3a49c54fdaf76b7fa`). Author script: https://github.com/Istituto-Mario-Negri-Medical-Imaging/LungSCAPE/blob/main/run_model191.py . Dataset191 is a **high-attenuation abnormality mask** model trained on **nine non-contrast COVID-19 chest CTs**, not an interstitial pulmonary fibrosis/UIP subtype detector. The full LungSCAPE MATLAB pipeline (GGO/reticulation/airway refinements) is **not** imported.

The local adapter `scripts/run-lungscape191-research.py` requires separately rights-cleared locally available source NIfTI, an externally installed nnU-Net v2 command, and all five real official fold checkpoints under `nnUNet_results/Dataset191_*/3d_fullres/fold_*/checkpoint_final.pth`. Install checkpoint from the *official* Zenodo download with the original `setup_model191.py` in an isolated CPU/GPU worker environment; review the model and data rights. **No auto-download** and no weight or CT data committed to the repo.

Prepare exactly one isolated input `case001_0000.nii.gz` preserving the real original CT NIfTI geometry, with correct DICOM HU conversion beforehand. Do not place private patient studies in cloud CI or third-party services.

```bash
python scripts/run-lungscape191-research.py \
 --input /private/research/in/case001_0000.nii.gz \
 --nnunet-results /private/models/nnUNet_results \
 --output /private/research/out
```

This is a read-only **readiness/hash report**, not inference. Add `--execute --device cuda` for explicit nnU-Net inference on a suitable local GPU (or `--device cpu` on an appropriately provisioned CPU host). The runner uses official nnU-Net v2 CLI and validates exact output shape and affine against the input before writing an aggregate numeric source/weights/mask SHA-256 research report; a failed inference never claims completed segmentation. It refuses an ambiguous input directory and never automatically runs on browser uploads. The trained model output is **not classified as honeycombing, IPF, UIP, or individual GGO classes** without author ontology and independent clinical mask comparison.

Limitations: this is an opt-in command-line adapter, not yet wired to the Opus HTTP worker or Cornerstone viewer. Its output numeric labels require author mapping validation before they can be overlaid as pathology evidence. The 1.2 GB weights and 3D nnU-Net can exceed the user's Mac M1/8 GB memory: prefer a separate opt-in GPU worker. No real-patient clinical use is authorized. The existing LongCIU human expert metrics remain distinct from any future model Dice.

## Native-source evidence increment (2026-10-20, research-only)

The opt-in original `nnUNetv2_predict` runner now calls
`scripts/lungscape191_native_evidence.py` **only after a successful genuine
prediction subprocess**. It checks the installed `Dataset191_*/dataset.json`
ontology (one CT channel, consecutive integer labels, background=0) rather
than assuming label 1 always means a clinical diagnosis. It refuses foreign
label IDs, nonintegral labels, mismatched source and mask affine/grid/units,
changed input SHA, input/output directory overlap, an excessively large CT,
or a stale/linked prediction path.

The resulting local `opus-lungscape191-research-report.json` contains
original model fold checkpoint SHA-256 hashes, input/output SHA-256,
the model `dataset.json` SHA-256, source voxel bounds per **model class**,
and aggregate voxel counts. If the NIfTI unit is explicitly millimetres,
it also reports class aggregate mL and an **axis-aligned RAS bounding box**.
Bounds are inclusive native voxel coordinates; an aggregate connected region
is **not** a distinct radiological lesion. Original CT pixels and masks stay
local, outside GitHub and outside the numeric research report.

This work is an evidence/output interface, **not a newly verified model
forward**. The heavyweight ~1.2 GB official weights are not downloaded by
CI; GPU/worker memory and genuine expert-positive CT are still outstanding.
A positive class is an unspecific **high-attenuation abnormality candidate**,
not UIP, NSIP, GGO subtype, fibrosis, or a diagnosis. A zero mask does not
establish absence of disease. The mask is not automatically displayed as an
approved patient finding. The published CoronaCases training overlap remains
unexcluded; a CoronaCases expert infection mask is **not semantically identical**
to high-attenuation-only output, so no Dice is claimed against it.

The adapter's lightweight offline source/grid/ontology contract is exercised
by `python -m unittest discover -s scripts -p test_lungscape191_native_evidence.py -v`.
It does not simulate an original nnU-Net forward.

## Isolated original fold0 forward trial (2026-10-21)

The original publisher Dataset191 five-fold model is still the reference protocol. The
isolated public-data Linux workflow now also runs on a narrowly scoped pull-request
change and attempts a **real original trained fold0 forward**, with nnU-Net native
preprocessing/export workers limited to one, step size 1, and mirror TTA disabled:

```bash
python scripts/run-lungscape191-research.py --execute --device cpu \\
 --research-single-fold0 --input /private/in/lungcase001_0000.nii.gz \\
 --nnunet-results /private/nnunet-results --output /private/out
```

This **reduced-compute original model**, if a genuine forward succeeds, is NOT the
author five-fold ensemble and its numerical results must not be described as author
ensemble accuracy. The binder refuses a result that falsely declares five folds.
The original five-fold checkpoint files are individually hashed even when only fold0
is run; actual used inference folds and the low-memory setting are reported distinctly.
The GitHub job is time/virtual-memory bounded and can legitimately FAIL on an
insufficient CPU runner. No outputs may be called observed until Actions confirms a
successful original forward. Training-cohort overlap remains unresolved and the
CoronaCases infection annotation is not equivalent to the author target ontology:
**no infection-vs-high-attenuation Dice, ILD subtype or clinical validation claim**.

## Public positive-source admission (research-only, separate from model)

`scripts/prepare-lungscape191-public-coronacases.py` supports a genuinely
published CoronaCases NIfTI chest CT and separate expert lung/infection masks.
The source is the [Ma et al. Zenodo 3757476 collection](https://zenodo.org/records/3757476),
served from the [MedOtter mirror](https://huggingface.co/datasets/MedOtter/covid19-ct-seg/tree/main).
The script pins the live mirror commit SHA, downloads only one case and its mask,
copies the CT bytes without resampling into an isolated private nnU-Net input
folder (`lungcase001_0000.nii.gz`), and keeps the expert in a **different**
`reference/` directory that is not an nnU-Net input. It measures original and
expert SHA-256, source NIfTI grid agreement, explicit unique annotation values,
and does **not** pass the expert to the model or compute a misleading Dice.
Only the numbers-only manifest may become a short-lived CI artifact. Source
NIfTI and pixel images must not be committed or uploaded to GitHub artifacts.

**Rights warning:** the Hugging Face mirror advertises CC BY 4.0 while the
original COVID-19-CT-Seg benchmark lists CC BY-NC-SA. Until rights are reconciled,
assume the more restrictive **noncommercial research-only** terms, with
attribution, and do not reuse commercially. No claim of independent model
validation: LungSCAPE reports training on nine CoronaCases scans; patient
training overlap is not excluded. This dataset annotates *infection*, which
is not semantically identical to the model's *high-attenuation* target.

Run only for publicly released research CTs:

```bash
python scripts/prepare-lungscape191-public-coronacases.py \
  --case coronacases_003 --output-private /isolated/research/lungscape-public \
  --execute-download
```

The corresponding opt-in GitHub workflow `lungscape191-real-public-ct.yml`
performs actual dataset retrieval and evidence auditing (no neural forward).
