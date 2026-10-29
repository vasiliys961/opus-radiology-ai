# Unified original brain DICOM MRI · ISLES22 and BraTS

**Reused, NOT new candidates**: real publisher-pretrained original ISLES22
\`nnU-Net v2 fold0\` for ischemic lesion segmentation on DWI+ADC+FLAIR,
and original MONAI \`brats_mri_segmentation\` SegResNet on four already
registered T1CE+T1+T2+FLAIR channels for whole-tumor, tumor core and enhancing
tumor research masks. Both tasks had a true positive public research forward
in the earlier separate GitHub workflows; this new **DICOM integration**
needs independent end-to-end model execution before any readiness claim.
Neither existing WMH FLAIR nor other disease model is duplicated.

## One physician button

Load full original DICOM MRI study in /viewer. In the same "Analyze study"
advanced section select exactly one clinical question:
* WMH FLAIR — existing pinned direct WMH worker.
* Ischemic lesion ISLES — explicitly map DWI, ADC, FLAIR *different* series.
* Glioma BraTS — map T1CE, T1, T2, FLAIR *different* series.

Every input MR DICOM series must have the same verified original StudyUID and
FrameOfReferenceUID as the selected head study, with source-valid geometry.
MRI weighting cannot be reliably inferred from basic DICOM scanning codes.
The physician therefore verifies correct sequence assignment, provenance,
rights and model compatibility. The original MR scalar voxels are independently
read, bounded, source-hashed and written as OPFS NIfTI using the existing
source geometry without a large memory allocation. One original model for
each distinct pathology. The authorized Linux worker receives the real
source bytes with exact SHA, runs the installed original weights and returns
native-source voxel candidate groups. Missing original model = NOT ASSESSED,
not a negative clinical result.

The worker requires an isolated Linux CPU (>=12GiB RAM and scratch disk),
\`nnunetv2==2.8.1\` for ISLES, \`monai==1.5.x\` for BraTS, original
author-published model files and model-specific correct library stack.
For ISLES checkpoint:
\`f9023888c7fe616ff271559acb82addd2496581fddd0a94e2d3c80bada5bb7e9\`.
For BraTS checkpoint:
\`860ccb3f1c21c99d0410ad8a1ac4ef6b8fab60cec0a503b0ba42675741a750ae\`.

\`\`\`sh
cd services/imaging-ai
python brain_multisequence_original_worker.py \
  --stroke-model-folder /private/ISLES22/publisher-nnunet-model-folder \
  --glioma-checkpoint /private/BraTS/official-model.pt \
  --origin http://127.0.0.1:3000
\`\`\`

One task may be omitted if its model checkpoint is not available.
Input source never goes to Gemini/Opus automatically. Patient data prohibited
in this research-only worker; external transfer requires independently
authorized de-identification, provider approval and separate policies.

**Known limits:** BraTS currently requires four already aligned original
240×240×155 volumes; oblique or geometrically irregular DICOM may be blocked
by bounded source converter. ISLES resamples ADC and FLAIR to DWI geometry
using the publisher preprocessing. Source MRI model coordinates are not yet
proven as exact DICOM SOP linkage. No clinical diagnosis, absence-of-lesion
claim, independent accuracy validation or cancer malignancy claim permitted.
Gemini and Opus are separately approved independent interpretive reviewers;
agreement with them does not establish clinical accuracy.
