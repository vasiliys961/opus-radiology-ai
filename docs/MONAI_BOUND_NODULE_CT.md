# Opus Radiology AI — live pretrained MONAI lung nodule CT integration (research)

**Scope:** This integrates a trained model onto a DIFFERENT, explicitly
authorized original chest CT from Opus. This is distinct from the old fixed LUNA16
demonstration. The CLI runs the official MONAI RetinaNet 0.6.9 pretrained bundle
on a full native CT using the same official preprocessing and postprocessing as
the earlier real LUNA run; the viewer can then open only the **same hash-matched
NIfTI** source and navigate to the model's research candidate projections.

This code is **not** yet proof that the new path has run successfully on a second
full CT or of clinical performance. The only real completed full CT inference
so far is the earlier pinned public LUNA16 source on GitHub Actions. CI for this
new adapter exercises **mathematical test data**, NOT the neural network.

## Acquire the research materials (outside Opus; no patient data in Actions)

On a private research Linux CPU server with measured **>=9 GiB free RAM** and
adequate disk, install the pinned compatible runtime in an isolated environment:
MONAI 1.4.0, PyTorch CPU 2.4.0, psutil, numpy and the official pretrained bundle
MONAI/lung_nodule_ct_detection at fixed revision
\`7226a40a4c3713f7d5469559b7f2fc296fd54825\`. Preprovision everything
**before disabling network**; \`--bundle\` must point to a local copy of the
official bundle with its \`models/model.pt\` (SHA-256
\`b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01\`)
and its original \`configs/metadata.json\`, \`configs/inference.json\` and
\`scripts\`. Never use \`git lfs\`/untrusted pickle files from unknown uploaders.

The research host/container, **not this Python script**, must enforce NO
NETWORK, a CPU memory/cgroup limit, file ACLs and research-data retention. The
runner itself guards measured process RSS <=10 GiB, system free RAM >=1 GiB and
runtime 55 minutes. It will never auto-download model weights. Do not run this
on MacBook Air M1 / 8 GiB.

From Opus workstation: export **original uncompressed float32 HU .nii**
via the existing full CT streaming research package or a source-equivalent
converter. A rightfully obtained publicly available chest CT must have an
orthogonal original NIfTI-1 sform in millimetres; no derived/resampled/localizer
series can be passed off as a verified full original scan. Original dataset
license and privacy must be checked by operator.

Source admission (private file, NOT GitHub):
\`\`\`json
{
 "schema":"opus-public-chest-nodule-admission/v1",
 "sourceNiftiSha256":"the 64-character SHA-256 of the .nii source",
 "modality":"CT",
 "anatomy":"CHEST",
 "intensity":"original-HU",
 "publicOrRightsClearedData":true,
 "containsPatientData":false,
 "fullSelectedSeriesPresent":true
}
\`\`\`

Run inside the network-isolated private Linux container (all paths local;
\`work\` and \`output\` **must not already exist**):

\`\`\`bash
python services/imaging-ai/monai_bound_nodule.py \
  --source /research/chest.nii \
  --admission /research/chest-admission.json \
  --bundle /models/lung_nodule_ct_detection \
  --work /research/tmp-new-work \
  --output /research/monai-bound-nodules.json \
  --authorization PUBLIC-CHEST-CT-NODULE-RESEARCH-OK
\`\`\`

After a real successful model execution, the JSON binds original **input NIfTI
SHA-256, dimensions, LPS affine, weights SHA and CPU invocation metadata** and
reports bounding-box candidate scores, LPS centers and a native voxel
projection. Import this output along with the original matching CT into
\`/viewer → MONAI · узлы КТ\`. The 3D CT is **never loaded in browser RAM all at
once**: only one <=512×512 original axial index plane is decoded per view.
Use the score cutoff and individual candidate buttons to inspect findings.

## Hard clinical boundary

* The model output world coordinate → original MHD/DICOM LPS map is a
  mathematically consistent **research hypothesis**, not independent visual
  localization validation on the new dataset. Always perform physician
  verification. Cross-check an independently curated source expert annotation
  or medical phantom before trusting measurements.
* The research viewer is source-bound to one **NIfTI SHA and spatial frame**,
  not DICOM SOP instance UIDs. DICOM series binding remains future work.
* No candidate, low score, or zero-mask result never rules out lung pathology.
* This does not detect/characterize all lung cancers, mediastinal disease,
  pulmonary embolism, ILD, or other untrained labels.
* Model publisher explicitly disclaims clinical diagnostic use; external
  FROC, lesion sensitivity, false positives/scan and representativeness
  remain unmeasured. Changes from MONAI's evaluation window to CPU
  sliding-window 192×192×80 must be independently benchmarked.
* No private patient data or keys are sent to OpenRouter/Polza/GitHub/LLMs.
  No AI cloud or patient API is enabled.

Source: https://huggingface.co/MONAI/lung_nodule_ct_detection/tree/7226a40a4c3713f7d5469559b7f2fc296fd54825
