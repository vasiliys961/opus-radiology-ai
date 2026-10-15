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
