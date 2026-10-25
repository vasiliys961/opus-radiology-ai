# Opus Radiology AI — focused clinical v1 portfolio (owner decision, 2026-10-25)

## Binding scope decision
Stop treating 51 registry rows as 51 release commitments. **Do not delete trained experiments,
checkpoints, published evidence, or working code.** Remove duplicate conditions from the
ACTIVE delivery queue; retain alternatives as frozen research candidates. New localizations
below are **reserved and not approved for implementation until owner explicitly commands**.
Do not reopen them merely to increase PR counts.

## Active primary pathology streams (one lead detector per clinical objective)
These streams are not claims of clinical validation. "Observed" means original trained
forward on public research input, sometimes without reliable expert truth.

| Clinical target | Primary model / method | Current evidence and gate |
|---|---|---|
| CT pulmonary nodules | MONAI RetinaNet | Observed original LUNA16; independent lesion FROC missing |
| CT pleural and pericardial fluid | TotalSegmentator pleural_pericard_effusion | Real run; expert positive source reference missing |
| CT lung tumor | KS987 Lung site-specific model | Checkpoint pinned, real positive forward pending, >=64GiB worker |
| CT mediastinal lymph nodes | Raidionics CT_LymphNodes ONNX | Original CPU forward observed; require expert positive, lesion recall |
| CT pulmonary embolism | Published yzluka nnUNet (research only) | Dice .038119; unsafe performance, replace or improve before activation |
| CT intracerebral bleed | TotalSegmentator cerebral_bleed | Original study forward; independent expert overlay needed |
| MR ischemic stroke | ISLES22 nnUNet DWI+ADC+FLAIR | Dice .742857 on one source-associated case; holdout missing |
| MR glioma | MONAI BraTS | Single-case TC .974806, WT .918428, ET .935574; holdout missing |
| MR WMH | jil202 wmh_seg | Dice .691757; lesion recall 37/70; rights/holdout unresolved |
| MR brain metastases | QTIM-Lab T1CE 5-fold | 15 original files hash verified; forward not yet done |
| CT liver lesions | TotalSegmentator liver_lesions | Dice .229572; research only / rebuild strategy |
| CT pancreatic tumor | MONAI DiNTS | Dice .199821; research only / rebuild strategy |
| CT kidney cyst | TotalSegmentator kidney_cysts | Dice .924865 on one KiTS23 case; holdout missing |
| CT kidney tumor | KS987 Kidney site-specific | Original weights and KiTS23 expert positive available; >=64GiB forward pending |
| CT coronary calcification | AI-CAC SwinUNETR | Original forward observed on protocol-uncertain CT; not verified CAC |
| CT aortic calibre | TotalSegmentator aorta + source-native morphometry | No true positive AAA forward yet |
| CT spine fracture | RSNA22 cervical fracture | Research adapter only; original forward pending |
| MR prostate tumor | PI-CAI original | Original licensed model not acquired; no forward yet |

These are **18 active clinical targets** (several aren't yet functioning), not 18 validated
detectors. V1 must make actual selected-study DICOM -> protocol gate -> model -> source-registered
finding -> editable physician report work end to end. Never auto-run an unvalidated/pathway-blocked
model as if it can exclude disease. Research-only, offline and clinician-review safeguards remain.

## De-duplicated/frozen alternatives (not deleted)
- `lung-nodule-totalseg`: fallback research, NOT second active pulmonary-nodule target.
- `liver-tumor-ct-alt`: defer until primary liver lesion path clinically improves.
- `renal-neoplasm-3phase-ct`: retain as specialized future protocol, not another active kidney-tumor target.
- `brain-metastases-4seq`: retain BraTS Orchestrator as alternative; QTIM T1CE leads.
- `vertebral-fracture-ct` and `cervical-spine-fracture-ct`: consolidate into one fracture workstream.
- Bouget/CompAI MediastinalLymphNodeSegmentation: preserve genuine source evidence and
  code as alternatives; Raidionics ONNX leads. Stop standalone repeated CompAI metric
  contract PRs without genuine positive improvement.
- Six TorchXRayVision NIH DenseNet121 radiograph heads (pneumothorax, cardiomegaly,
  effusion, pneumonia, edema, lung mass) share a single image-level checkpoint and
  belong to a separately parked XR subsystem; NOT six independently localizing CT/MRI
  pathology detectors. OCT, WSI, mammography also out of CT/MRI v1 scope.

## Already implemented versus evidence missing
- Core DICOM 2D/MPR/3D viewer, partial protocol router, source-geometry and Evidence
  infrastructure are present; auto-first integrated workflow NOT complete.
- Several real original model research forwards are observed on public cases. A single
  original forward, green CI or model archive SHA is NOT a clinically deployable detector.
- Unresolved: independent positive/negative datasets, case and lesion sensitivity/FP,
  spatial physician review, reproducible model execution and actual compatibility,
  workload/compute preflight, safe deployment, clinician-approved report.

## NEW ANATOMIC REGIONS — OWNER-APPROVAL WAITLIST
No implementation solely on this proposal.
1. Retroperitoneum: retroperitoneal lymphadenopathy and adrenal lesions (license-limited).
2. Pelvis: pelvic ring fracture and pelvic masses; prostate workstream already active.
3. Spine and musculoskeletal: metastatic spine disease, degenerative discs/stenosis,
   hip avascular necrosis.
4. Hepatobiliary: gallstones and cirrhosis/fibrosis imaging signs (separate tasks).
5. Urinary system: ureteric calculi/obstruction (kidney cyst/tumor already active).
6. Chest: primary mediastinal masses and pleural/chest-wall tumors.
7. Brain: multiple sclerosis lesion-specific detection and TOF aneurysms.
8. Heart and vessels: aortic dissection (rights gated), structural cardiac assessment.

Only owner may move waitlist items into active implementation. No silent promotion
of anatomy-only masks, HU cutoffs, unlicensed weights or external cloud inference.

## Immediate delivery criteria
1. Select a representative licensed public chest CT, prove complete native DICOM study
   auto-selection and at least one verified original compatible trained forward.
2. Display true source-linked findings in physician MPR, with unit-correct measurements,
   evidence, uncertainty and reviewed editable report. No invented normal findings.
3. Repeat for representative brain MRI and abdominal CT using currently functioning
   models and clearly stop unsupported protocols.
4. Then independently validate and widen coverage; prioritize positive expert cases
   rather than more adapter-only PRs.

## OWNER DECISION — 2026-10-25: FINISH EXISTING DETECTORS; GEMINI + OPUS ASSIST FOR REMAINDER
This supersedes the earlier suggestion to begin the new-region waitlist. **No
new specialized detector streams, even for the 16 requested pathologies, until
owner explicitly reauthorizes.** The immediate goal is to finish and integrate
the existing 18 core targets, address very low-accuracy research models and
deliver a complete physician review workflow.

Two evidence paths, never conflated:
1. **Specialist model**: compatible modality/protocol, pinned rights-cleared original
   weights and source-native mask/candidate coordinates. Missing or failed model
   must stay unavailable/unknown rather than negative.
2. **Independent Gemini and Claude Opus vision review**: optional research-only
   interpretation of explicitly selected, source-linked deidentified images/MPR.
   Models should independently describe findings and uncertainty; they DO NOT
   manufacture unobserved volumes, claim full CT/MRI coverage from a sparse montage,
   infer absent pathologies as excluded, or replace specialist voxel segmentation.
   Disagreements remain visible to the physician in Evidence JSON.

Default patient-cloud transmission remains **OFF**. Real patient imaging transfer
requires demonstrated tag AND pixel de-identification, clinician authorization,
a lawful processing basis, jurisdiction/provider retention review and explicit
per-study consent/activation. No credentials or PHI in CI/GitHub logs.

Delivery first: selected DICOM -> protocol checks -> compatible available
specialist jobs -> explicitly bounded anonymized vision inputs only when authorized
-> independently attributed Gemini/Opus results -> disagreement-aware Evidence
-> source-linked physician MPR -> editable clinician-approved preliminary report.
Offline worker and expert physician assessment always remain possible without LLMs.
