# ICH: independently annotated BLOOD ROI vs genuine pretrained detection boxes

Goal: move from the REAL, already-executed ianpan pretrained 25-slice public
ICH CT (and source-native voxel boxes) toward an **evidence-based hemorrhage
localization comparison** without fabricating radiologist labels.

New offline researcher command:
`scripts/evaluate-ianpan-ich-expert-roi.py`.

It takes an exact source NIfTI, genuine pretrained ICH numeric JSON, a
**separately authorized ORIGINAL expert hematoma NIfTI labelmap** on the same
source-voxel affine, the original dataset's published `labelMeaning` ontology
(`IPH`, `IVH`, `SAH`, `SDH`, `EDH`), and source-specific expert annotation
provenance. The evaluator independently verifies the hashes of all inputs and
matches both source/mask 3D geometry at eight world-space corners within
0.05 mm. It never resamples, rewrites, windows or constructs a fake mask.

It compares each subtype's genuine research bounding ROIs to the
**original expert blood voxels** and reports:

- number of expert-labeled **blood** voxels and expert mask volume (provided
  annotation, **NOT** the model's predicted blood volume);
- number of pretrained model source bounding regions of that subtype;
- number and fraction of expert blood voxels physically located **inside
  the union of these model bounding envelopes**;
- 6-connected expert blood-mask fragments that geometrically intersect
  at least one model source box, and unmatched expert voxels.

The broad classifier channel `any` is not counted as a separate lesion.
Overlapping and adjacent model boxes are unioned only as *bounding boxes*,
never voxel segmentation. A bounding box may contain blood without the
model heatmap actually classifying that pixel; therefore these measurements
**ARE NOT** model voxel recall, hematoma Dice, clinical lesion true
positives, predicted hematoma volume or sensitivity.

## Required licensed independent reference

`original-ontology.json` uses the existing documented schema:

```json
{
  "sourceUrl":"https://<official-annotation-ontology-source>",
  "labelMeaning":{"1":"IPH"}
}
```

`original-blood-reference-admission.json` must be separately obtained
from the authorized expert hematoma annotation and contains:

```json
{
  "schema":"opus-ich-external-hematoma-reference-admission/v1",
  "sourceCtSha256":"<original source SHA-256>",
  "originalExpertMaskSha256":"<original expert mask SHA-256>",
  "originalOntologySha256":"<original ontology JSON file SHA-256>",
  "annotationTissue":"HEMORRHAGE_BLOOD_NOT_EDEMA",
  "maskWasDrawnIndependentlyOfEvaluatedModel":true,
  "originalExpertLabelmapUnmodified":true,
  "referenceDatasetResearchRightsReviewed":true,
  "researchUseAuthorized":true,
  "expertReferenceAuthenticityIndependentlyAuditedByOpus":false,
  "sourceNiftiGridResampledForEvaluation":false,
  "originalExpertMaskCitationUrl":"https://<official-expert-hematoma-reference>",
  "sourceDatasetUrl":"https://<approved-original-ct>",
  "labelOntology":{"1":"IPH"}
}
```

All values are **operator-attested**, not self-verifying radiologist
signatures. SHA-256 proves bytes correspond to the provided manifest,
NOT that a person labeling data is a radiologist. Do not synthesize
or retroactively label a dataset's edema mask as a blood reference.

Run on an authorized external research host, never on user-owned
patient CT without explicit data rights:

```bash
python scripts/evaluate-ianpan-ich-expert-roi.py \
  --source /authorized/original-public-ct.nii \
  --source-sha256 <exact-original-ct-hash> \
  --expert-mask /authorized/original-expert-blood.nii.gz \
  --expert-sha256 <exact-original-blood-mask-hash> \
  --genuine-model-report /authorized/genuine-ianpan-report.json \
  --original-ontology /authorized/original-ontology.json \
  --reference-manifest /authorized/original-blood-reference-admission.json \
  --output /authorized/ich-blood-spatial-comparison.json \
  --rights-attested \
  --permission-token REVIEW-TRUE-HEMORRHAGE-REFERENCE
```

It rejects mismatched CT/mask source shape or affine, altered model report,
unsupported source voxels, unidentified expert blood labels, negative
rights attestation, absent source annotation, normalizing/scaling the
expert mask, and original PHE-SICH-CT-IDS **edema masks** misrepresented
as hemorrhage.

## Present dataset status — important

Real pretrained inference is already confirmed on a legally obtained
PHE-SICH-CT-IDS CT with one IPH-like source-bound candidate extending
through axial indices 9–15. But its official expert masks segment
**perihematomal EDEMA**, not the blood itself. The official Figshare data
page confirms this: https://figshare.com/articles/dataset/PHE-SICH-CT-IDS/23957937.

A separate dataset such as BHSD may contain original manual hematoma
labels, but its official authors specify an **NC-ND** restriction
(https://github.com/White65534/BHSD). Accordingly this development
does NOT download, transform, relicense, use, test or upload BHSD content
automatically. Any future original expert blood mask must have its own
demonstrably authorized purpose and matching source CT.

No real expert **hematoma** localization match for our exact public
25-slice source is claimed. The CI uses small synthetic CT/mask fixtures
to exercise true cross-grid comparison and strict refusal of edema.
No medical images, identifiers, real weights or permissions are
required from the user to develop and merge this feature.
