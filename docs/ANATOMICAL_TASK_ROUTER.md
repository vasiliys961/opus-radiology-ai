# Study Intelligence — CT abdomen and MR brain research task router

**Status: task-planning and fail-closed triage only; no new model execution.**

This first multi-anatomy increment adds the pure, local
\`web/lib/anatomy-task-router.ts\` to existing Study Intelligence. It produces
an explicit plan for **CT chest lung lobes**, **CT abdominal organs**, and
**multi-series MR brain** when an exact allowlisted BodyPartExamined, CT/MR
modality and source series are available.

- CT abdomen requires a **separately installed and cleared** TotalSegmentator
  \`total\` task or independently benchmarked suitable organ model;
  **liver/kidney/spleen segmentation is not yet connected**. HU pixel
  calibration and any contrast phase remain unverified by technical DICOM
  tags and must be checked at model handoff.
- MR brain tumor tasks need registered **T1, T1c, T2 and FLAIR**.
  TR/TE/TI/IR are hints only; they cannot prove the four sequences or T1c.
  Series are grouped strictly by StudyInstanceUID, and no unrelated study
  is silently included. Specific BraTS/nnU-Net checkpoints and independent
  clinical metric evaluation are not yet connected.
- CT thorax carries a pointer to the separately verified public
  TotalSegmentator five-lobe pipeline, not a claim that patient-mode
  inference can be launched from Study Intelligence.

Every route is **\`execution:not_connected\`, \`canRun:false\`** and
\`clinicallyValidated:false\`. All routes explicitly flag unverified
coverage, model weights and patient/cloud authorization. Neither a missing
sequence nor a missing mask may be interpreted as absence of disease.
No DICOM pixel, patient metadata, keys or remote API calls are used.

Next integration step, after separately verified checkpoints/licenses and
public reference acceptance: choose a concrete organ or brain-model task,
verify every series' HU or MR contrasts and input geometry, use native-grid
output checks, then enable per-model opt-in research inference only after
measured memory/cost and permissions. No automatic model switching.
