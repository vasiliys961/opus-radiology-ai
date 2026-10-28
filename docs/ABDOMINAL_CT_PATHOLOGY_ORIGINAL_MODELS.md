# Two additional authentic CT pathology model execution paths (research)

`services/imaging-ai/abdominal_ct_pathology_inference.py` can execute **two separate
original pretrained TotalSegmentator 2.18.0 tasks** on a lawful *nonpatient*
abdominal CT NIfTI with original HU values:

- `kidney_cysts`: native candidate masks for **left and right kidney cysts**.
- `liver_lesions`: native candidate mask for **focal liver lesions**.
  A lesion is not necessarily a tumor or malignancy.

The runtime is genuine only if the caller has installed official pretrained
weights and uses the real TotalSegmentator API. No model weights are committed to
GitHub; **a successful contract test is not a real pretrained forward pass**.

Requirements: isolated Linux CPU host with >=10 GiB *available* RAM, pinned
`TotalSegmentator==2.18.0`, verified source rights and an OS-enforced network
isolation/cgroup budget. The MacBook Air M1/8 GB is not a suitable worker.
Obtain the original checkpoint using the upstream official weight installer and
separately verify its exact SHA-256 (the file digest alone cannot prove which
internal checkpoint the vendor API selects). This is an opt-in research workflow,
not patient clinical processing.

The operator creates a private, local-only admission JSON (never commit it):

```json
{
  "schema": "opus-abdominal-ct-pathology-admission/v1",
  "task": "kidney_cysts",
  "sourceNiftiSha256": "<64-hex-of-original-HU-CT>",
  "sourcePublicAndRightsCleared": true,
  "imageLicenseReviewed": true,
  "researchOnly": true,
  "originalHuVolumeVerified": true,
  "notPatientData": true,
  "modelLicenseReviewed": true
}
```

Use `task: liver_lesions` for the distinct hepatic model. Run inside
the isolated model container (use **fresh** output paths):

```bash
python services/imaging-ai/abdominal_ct_pathology_inference.py \
  --task kidney_cysts \
  --source /private/source-ct.nii \
  --output-mask /private/result/kidney-cysts.nii.gz \
  --output-json /private/result/kidney-cysts.json \
  --checkpoint /private/weights/checkpoint_final.pth \
  --checkpoint-sha256 "<observed-checkpoint-file-sha256>" \
  --source-admission /private/admission.json \
  --authorization PUBLIC-ABDOMINAL-CT-RESEARCH-OK
```

Outputs from **genuine completed model inference**, once available, include
native XYZ bounds, RAS-mm bounding boxes, involved original index-K slices,
class volumes, source NIfTI SHA-256 and output-mask SHA-256, with original
model/package identity. A failed inference removes partial outputs.

Limitations: no independent positive public-case forward performed by the
new contract CI, no independent checkpoint loader attestation, no DICOM SOP
identity link, no clinical validation (Dice/lesion recall/FROC unknown). Empty
model masks **do not** establish absence of pathology.

Next evidence gate: run each trained model on permitted original positive
public CT and compare to independent expert-labelled masks; then bring its
output into the original-DICOM viewer without reimplementing the models.
