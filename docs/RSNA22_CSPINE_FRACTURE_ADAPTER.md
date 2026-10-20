# Cervical CT fractures (C1–C7) — original trained model research-adapter candidate

Source: https://github.com/zxjasonhu/cspine-2022-challenge-inference-collection
Original pretrained winner weight publications:
https://www.kaggle.com/models/zixuanh/cspine-1st-place-solution-model-weights
and https://www.kaggle.com/models/zixuanh/cspine-3rd-place-solution-model-weights.
Published comparison: https://pubs.rsna.org/doi/10.1148/ryai.230550 .
These are **pretrained author weights candidates**, not assets independently downloaded
and validated in Opus. GitHub code repository license does NOT establish Kaggle model
weights or CT dataset permission. Verify both individually.

The new `scripts/admit-rsna22-cspine-fracture-evidence.py` is an **opt-in local
research-result adapter**. The original author inference runs separately on a
dedicated licensed DICOM study and emits a CSV with exactly one row and
`StudyInstanceUID,patient_overall,C1,C2,C3,C4,C5,C6,C7`. The adapter checks
seven finite class probabilities, one exact private DICOM study UID,
two SHA-format provenance fields, refuses excess rows and emits a **numeric-only**
report without the study UID. This is *not itself original model inference*.
It accepts caller-provided source/checkpoint SHA strings but does not verify
those original bytes or establish the model actually ran. Unverified model
scores must stay under research review. Do not display them as true sourced
medical findings or as absence of fracture.

Next real milestone: check Kaggle model licensing/download access, SHA-256 actual
publisher weights; obtain lawful deidentified positive C-spine CT and C1–C7
expert fracture labels, run original inference on a separate GPU, verify
DICOM image spacing/slice order/SOPs and quantify held-out vertebra AUROC,
sensitivity and false findings. Classification probabilities do not supply a
local voxel lesion overlay. No real patient cloud upload authorized.
