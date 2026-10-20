# FLAMeS: original trained MS lesions on FLAIR MRI (research only)

**Different task from WMH**: The published FLAMeS FLAIR lesion model is MS-lesion-trained; existing `wmh_seg` identifies nonspecific WM hyperintensities. Neither model alone can establish MS, disseminated lesions in space/time, active demyelination, or differentiate all ischemic WMHs.

**Publisher:** Francesco La Rosa et al., 2025, [Zenodo 17955359](https://zenodo.org/records/17955359) and [paper](https://doi.org/10.1111/jon.70085). Original nnU-Net v2 `Dataset004_WML.zip` is **2.4GB**, publisher MD5 `8b90b789d6ceca1886f42fa1724a08cc`; requires `-d 004 -c 3d_fullres -tr nnUNetTrainer_8000epochs`. The model was trained on 668 scans; no independent accuracy claim is made here. Copyright/licensing and data/weights commercial reuse must be independently reviewed; **research-only by default**. Publishing a downloadable model does not establish patient-use licensing.

## True executor

`scripts/flames_ms_research.py` is an **actual executable original model** adapter, not a synthetic ML model or repurposed WMH classification. Provide exactly one *already skull-stripped* 3D FLAIR `mscase001_0000.nii.gz`, and a separate binary source-native brain extraction mask (prefer publisher-suggested SynthStrip `--no-csf`). The script verifies every source voxel outside this supplied brain mask is zero, source/mask affine/shape/physical mm units, input SHA, installed nnU-Net original 8000-epoch trainer folder, original dataset.json binary ontology and exact original checkpoint SHA for each installed fold.

Install original author weights in an **isolated 12–24GB+ GPU/CPU Linux worker** via standard `nnUNetv2_install_pretrained_model_from_zip`, after verifying the publisher archive's MD5. **Never place 2.4GB weights on the user's Mac M1 8GB**; never send real patient images to GitHub Actions. This adapter does NOT automatically download archives or contact cloud services.

Readiness, no actual prediction:

```bash
python scripts/flames_ms_research.py \
  --source /private/in/mscase001_0000.nii.gz \
  --brain-mask /private/brainmask/mscase001_mask.nii.gz \
  --nnunet-results /private/nnUNet_results \
  --output /private/output
```

On licensed, publicly released, de-identified **research-only** FLAIR, actual original publisher nnU-Net inference:

```bash
python scripts/flames_ms_research.py \
  --source /private/in/mscase001_0000.nii.gz \
  --brain-mask /private/brainmask/mscase001_mask.nii.gz \
  --nnunet-results /private/nnUNet_results \
  --output /private/output --device cuda --execute
```

The original CLI writes the true NIfTI mask locally. After **successful** original forward, the adapter verifies source grid and computes each 26-connected label component's native voxel bounds, RAS-mm centroid, original source SHA, model-fold digests, aggregate volumes and a physician-research JSON `flames-ms-numeric-evidence.json`. The output mask stays local; only the numeric report can be shared after appropriate rights checks.

**Current evidence level: research executor implemented; actual published archive not installed/tested in this PR, model forward NOT demonstrated, no positive licensed expert-masked case, no Dice/lesion recall/independent specificity, no patient or cloud deployment**. A negative segmentation is not a negative MS diagnosis. Follow-up: resolve publisher archive licensing, isolate positive annotated MS FLAIR (MSSEG eligible, check split), verify genuine trained inference and expert lesion sensitivity without training overlap.

CI `flames-ms-flair-contract.yml` checks source/native geometry guards with synthetic inputs **without claiming trained model execution**.
