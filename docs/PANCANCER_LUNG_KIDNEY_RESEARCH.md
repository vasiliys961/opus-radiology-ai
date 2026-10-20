# Original pretrained KS987 PanCancerSeg: kidney and lung primary tumor candidates

**Two site-specific original trained 3D models, not generic organ anatomy**, and **not a deployed diagnostic service**.

The author publishes separate nnU-Net v2 3D full-resolution checkpoints for kidney cancer (`Dataset102_Kidney`) and lung cancer (`Dataset105_Lung`): [publisher weights](https://huggingface.co/KS987/PanCancerSeg-Specialized-weights), [original inference guide](https://github.com/Kappapapa123/PanCancerSeg-Specialist-Inference). Model card claims Apache-2.0 for weights; input FLARE challenge dataset terms and commercial patient-use rights must be independently assessed. A published checkpoint does NOT mean the exact weights, original source scans, or diagnosis have been tested in Opus.

### Clinical guard

Author training used site-specific FLARE pan-cancer labels (partially annotated primary tumors; other lesions may be present and unlabeled). Output class 1 is **a tumor proposal**, not automatically malignancy, metastasis screening or negative cancer exclusion. Kidney model accepts a **single CT scan** (not equivalent to existing MONAI 3-phase renal model); lung model is not a LUNA16 pulmonary nodule model, and does not stage lung cancer. Training overlap with public validation examples is not excluded. No patient input to remote APIs.

**64GB memory issue**: upstream explicitly warns inference resampling may need ~64GiB RAM. The opt-in executor in `scripts/pancancer_lung_kidney_research.py` requires **>=64GiB currently available memory on a separate Linux CPU/GPU worker** before it even starts the original trained model. The user's M1/8GiB and ordinary small GitHub Actions VMs are *not* permitted. The code does not download weights or launch itself from browser.

Required isolated inputs:
1. One lawful deidentified research 3D **original HU CT** (not 8-bit PNG, not reshaped, not synthetic) named `case001_0000.nii.gz` in its own source directory; verified exact physical-mm NIfTI affine.
2. Verified official `KS987/PanCancerSeg-Specialized-weights` model directories with only the needed original `fold_0/checkpoint_best.pth`, original author dataset.json and plans.json. The **original trainer class `nnUNetTrainerWandb2000` from the publisher** must be installed and audited separately in nnU-Net v2, no arbitrary `trust_remote_code` bypass or automatic source execution. Model/plan and checkpoint SHA-256 reported.
3. Suitable provisioned isolated Linux worker with explicit permission to handle *public research* CT. No source, masks, weights, PHI or media committed or uploaded to GitHub.

Readiness report, no inference:

```bash
python scripts/pancancer_lung_kidney_research.py \
  --ct /research/in/case001_0000.nii.gz \
  --nnunet-results /research/official/nnUNet_results \
  --output /research/out --target lung
```

Genuine original nnU-Net fold0 forward (requires >=64GiB available memory, executor + audited original custom trainer):

```bash
python scripts/pancancer_lung_kidney_research.py \
  --ct /research/in/case001_0000.nii.gz \
  --nnunet-results /research/official/nnUNet_results \
  --output /research/out --target kidney --device cuda --execute
```

The runner invokes the original `nnUNetv2_predict` command and `checkpoint_best.pth` with the author trainer/plans. After successful original forward, the source hash is rechecked; the produced native CT NIfTI segmentation must match source shape and affine within 0.1mm; labels are restricted to {0,1}. It builds 26-connected voxel candidates with native bounds, RAS-mm centroid and physical volume. Original CT and mask stay locally private; `pancancer-original-numeric.json` is a report of hashes, *candidate* geometry and limitations, not patient data.

**This PR only installs an opt-in executable research adapter, synthetic-code contract tests and a registry candidate. No publisher weight download, forward, positive original expert-mask Dice or independent holdout is claimed.** Next: acquire/checkpoint SHA and run on a licensed independent positive CT with expert tumor mask, ideally large isolated CPU/GPU resources, then source-bound true TP/FP/FN and clinician MPR overlay. If 64GiB is unavailable, park expensive executor and continue different pathology rather than raising Mac memory guards.

## Original publisher checkpoint SHA-256 pins — verified 2026-10-20

Public real [GitHub Actions asset-verification workflow](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39484700749) **downloaded actual trained original bytes** at full Hugging Face revision `7f0906ddcb93d139c53c720ddc56208a5af5ad7b`:

- Dataset105_Lung fold_0/checkpoint_best.pth: `bb14da9985955dee14ac09af7ce233f896f30e538b14b0c595498e694dbef15d`
- Dataset102_Kidney fold_0/checkpoint_best.pth: `5a1c9e2894160d50dfa0f8c0ac0a88198897973f642c0cbeb33e935457fd9d8c`

The **--execute** runner now rejects a replacement local checkpoint whose hash differs from the actual published bytes. Merely having the right filename, dataset.json or nnU-Net trainer configuration never bypasses this. Its ordinary readiness mode still reports the observed hash and an explicit mismatch flag without trying to execute a model. These are **verified model ASSETS**, not an inference accuracy report; no clinical diagnostic claims, positive CT forward, Dice, or independent validation are established.
