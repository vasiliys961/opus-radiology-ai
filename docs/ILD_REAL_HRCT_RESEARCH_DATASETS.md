# ILD / HRCT pathology datasets — verified 15 October 2026

Priority: detect actual HRCT patterns, with **original pixel location**,
independent expert labels and separate diagnostic pattern classification,
NOT claim "all fibrotic ILD" from one COVID GGO model.

## Source gate table

| Research resource | Original data / labels | Rights/access | Valid clinical evidence |
|---|---|---|---|
| HUG-ILD, University Hospitals of Geneva (Depeursinge et al. 2012) | 128 pathology-supported ILD cases; 108 HRCT series with 3D tissue-pattern ROIs; 13 histological diagnoses | **Request + signed research end-user license** to adrien.depeursinge@hevs.ch; NOT publicly fetchable without authorization | Main reference candidate for ILD texture ROIs, no data imported without agreement |
| LongCIU (Carmo et al. 2025), DOI 10.25820/data.007301 | 90 independent 2D axial CT slices from Long COVID patients, three manual segmentations and STAPLE consensus, labels 1=GGO and 2=consolidation | Open Data Commons Attribution 1.0; original data at Iowa and source-authored code MICLab-Unicamp/LongCIU; mirror `MedOtter/LongCIU` pinned HF `c4b975090c16fabe59079a528dd920d956e16c66` | Medical-reader agreement and GGO/consolidation research benchmarks; **not true contiguous 3D CT and not a reference diagnosis of fibrotic ILD** |
| OSIC Pulmonary Fibrosis Progression, Kaggle | Baseline CT **DICOM** plus serial FVC clinical data | Kaggle-specific competition terms, CC BY-SA 4.0 and ethics/privacy restrictions; must accept conditions | Prognosis and pulmonary-function evolution, **NOT voxel-level honeycomb/fibrosis truth** |
| AIIB23 MICCAI 2023 | HRCT of fibrotic lungs, **airway segmentation** | Participation/registration; noncommercial no derivatives restrictions | Airway assessment and robustness in distorted fibrotic lungs, **not honeycomb segmentation truth** |
| LungSCAPE (2025 paper; public repo 2026) | Apache-2.0 code for multi-stage HRCT segmentation of GGO, reticulation/consolidation, air trapping | Full protocol REQUIRES MATLAB Image Processing + Parallel Computing toolboxes and third-party libs; nnU-Net model 191 archived on Zenodo **trained on 9 COVID CT scans** | Interesting candidate for modular research pipeline, **NOT clinically validated UIP/IPF honeycomb detector** |
| COVID-19 CT Seg / Zenodo 10.5281/zenodo.3757476 | 20 labeled COVID CT cases with bilateral lungs and infection masks | Public data, verify specific file conditions | GGO/infection segmentation transfer experiments, NOT ILD subtype adjudication |

Sources:
- HUG-ILD https://medgift.hevs.ch/wordpress/databases/ild-database/
- LongCIU dataset https://doi.org/10.25820/data.007301
- LongCIU technical reference https://github.com/MICLab-Unicamp/LongCIU
- OSIC https://www.kaggle.com/competitions/osic-pulmonary-fibrosis-progression/data
- AIIB23 https://doi.org/10.1016/j.media.2024.103253
- LungSCAPE https://github.com/Istituto-Mario-Negri-Medical-Imaging/LungSCAPE
- Published model191 weights https://zenodo.org/records/18860414
- COVID-19 source https://zenodo.org/records/3757476

## Actual source-backed LongCIU result completed

[Real GitHub-hosted Linux CPU Actions #38753711714](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38753711714)
**downloaded five original NIfTI MASK files**, verified each against
publisher SHA256 from pinned Hugging Face mirror, and calculated Dice
by the author's ORIGINAL designated test-40 independent axial slices.

Files: `longciu_1_tgt.nii.gz`,
`longciu_2_tgt.nii.gz`, `longciu_3_tgt.nii.gz`,
`longciu_STAPLE_tgt.nii.gz`, `longciu_medpseg_output.nii.gz`.
No original CT pixels, model weights, or individual patient IDs were ever
uploaded to GitHub. One numeric-only artifact #11982242910 contains the
full original research result, original 6,059-byte JSON SHA256
`8864abeb2d8c0f4363f3d422eb4f78f7b174d653e245b77b76d69b2594ec67ce`.

Mean per-slice Dice vs STAPLE on authors original 40-slice held-out split
(exclude both-empty samples; no clinical model claims):

| Target | Human annotator 1 | Human 2 | Human 3 |
|---|---:|---:|---:|
| Ground glass opacity (GGO) | 0.745559 | 0.854955 | 0.648818 |
| Consolidation | 0.515743 | 0.580319 | 0.615898 |

For consolidation the evaluable union slice counts differ:
26/40, 28/40 and 30/40 respectively. GGO was nonempty on
all 40 test slices. Original 90-slice human annotator 1 vs STAPLE GGO
mean Dice **0.772510** independently reproduces the authors'
`dice.ipynb` documented 0.772510269, a useful independent reproduction.

**Unresolved pretrained segmentation alignment:** published
`longciu_medpseg_output.nii.gz` contains values 0,1,2,3. The authors'
`dice.ipynb` compares ONLY label 1 (GGO) and 2 (consolidation), leaving
3 as other/nontarget; our first strict classifier rejected the extra label.
Using that source-author class mapping on actual original files yielded
unexpectedly low direct mask-overlap values (test40 GGO 0.095942,
consolidation 0.044738). **Do not claim these as validated MEDPSeg
performance** until the precomputed model output's orientation,
physical registration, mask encoding and provenance are separately
checked. We never perform a model run ourselves in this benchmark.
Do not tune mask mapping using the evaluation set to inflate Dice.

## Next pathology detector acceptance plan

1. Acquire rights-cleared full source HRCT and expert pattern mask(s),
   distinguishing irregular reticulation, GGO, subpleural honeycomb,
   traction bronchiectasis and consolidation. GGO is **nonspecific**:
   post-COVID changes do not establish UIP or IPF.
2. Pick legal open source weights by clinical task, verify full original
   image HU (including DICOM RescaleSlope/Intercept), scanner kernel,
   inspiration, slice spacing, internal/external split and source voxel
   registration. Training splits must be at **patient level**.
3. Run independent specialist detector on a real CT using isolated GPU/CPU
   as resources permit, then quantify true source-region pattern Dice
   against appropriate *independent* expert annotation.
4. Ask Gemini and Claude Opus independently about original rights-authorized
   pixels and documented clinical context, before showing model findings,
   and compare disagreements; VLM agreement does not replace expert labels.
   Never send patient images to remote APIs without explicitly permitted,
   documented research/clinical data rights and privacy authorization.
5. Enable only evidence-backed research overlays in the browser.
   M1/8GB remains a display/limited compute client, heavy pathology
   networks execute on hosted worker and checkpoints are lazy-loaded.

Development must not request the owner to run code or download 1.2 GB
models and does not turn this research output into patient clinical mode.
