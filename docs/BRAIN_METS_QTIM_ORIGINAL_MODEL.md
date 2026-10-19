# Brain metastases — real original QTIM-Lab 5-fold T1CE model executor

**New MRI pathology, independent of Opus glioma detectors.** Research only; no
patient diagnosis. This is a genuine execution adapter for the **publisher's
original five-model trained ensemble**, not an original newly trained network.

## Publisher/source and license

Original: [QTIM-Lab/Brain-Mets-Seg](https://github.com/QTIM-Lab/Brain-Mets-Seg),
pinned upstream main commit:
\`02d100e106b7076c66293ebcf6e122f8eb8e6e9e\`.
Code **and author-distributed weights**: Apache 2.0 per publisher's own README.
Original vendor images: TensorFlow 2.10 / CUDA / NVIDIA DALI in NGC base.
Published source Dockerfile fetches five model-specific checkpoint pairs
\`Model_0\` ... \`Model_4\` from publisher-linked Dropbox. The original
\`predict.py\` emits **binary segmentation**, **probability** and **uncertainty**
NIfTI volumes. It expects skull-stripped, registered, N4-bias-corrected,
z-normalized 1 mm isotropic **T1 with contrast**, not any unspecified brain MR.

**No downloaded original trained checkpoint, GPU forward or positive MRI scan
has yet been checked for this new task inside Opus.** Merely having code or
a published download URL does not count as a new measured detector.

## What the Opus adapter does

\`scripts/real-brain-mets-t1ce-qtim.py\`:
- Input: *licensed, deidentified public* contrast-enhanced preprocessed T1 NIfTI,
  with exact byte SHA256 in a separate user-confirmed JSON source manifest.
- Accept only explicitly documented T1 with contrast; reject missing
  preprocessing, unstable image grid, NaNs, unbounded volumes, changed checksum
  and unknown data license. Manifest is supplied metadata; **not independently
  cryptographically authenticated confirmation of the acquisition**.
- Require the actual publisher Docker image built from the original pinned
  source and user's explicitly recorded local SHA256 image ID; reject a changed
  or missing image. Check all **five** checkpoint data + index pairs in the image
  *before* inference (their vendor source digest is still unverified).
- Run the author's original \`predict.py\` in an isolated local NVIDIA Docker
  container with \`--network none\`, \`--read-only\`, no privilege escalation,
  read/write access only to fresh temporary public-research scratch.
- Emit native-to-*preprocessed*-image voxel boxes, RAS centroids, volume
  in milliliters, component count, mean uncertainty, segmentation/probability
  SHA256. The coordinates **are not claimed to be original raw DICOM coordinates**.
- Optionally align *existing exact-grid binary expert mask* and compute
  TP/FP/FN/Dice; do not infer held-out training independence from this.

The mask is never auto-uploaded to GitHub, the viewer or a text LLM.
The script emits only numeric anonymized evidence. Model cannot run on Mac
M1 8 GiB or a web browser; a dedicated NVIDIA GPU research worker is needed.

## Safe example with an already prepared, licensed public MRI

Prepare a fresh dedicated GPU Linux environment and build original publisher
Dockerfile at the pinned commit. **Review upstream docker build network, scripts
and official Dropbox downloads**; don't run untrusted code with \`--privileged\`.
The original readme shows privileged execution, but our inference wrapper
explicitly does NOT use \`--privileged\`.

Record the exact local Docker image ID from:
\`docker image inspect qtim-brain-mets-original:research --format '{{.Id}}'\`.

Place preprocessed original T1CE at \`/scratch/authorized-public/t1ce.nii.gz\`.
Place its provenance in \`/scratch/authorized-public/source.json\`:

\`\`\`json
{
  "schema": "opus-public-mri-t1ce-source/v1",
  "modality": "MR",
  "sequence": "T1-CE",
  "inputNiftiSha256": "<actual SHA256 of the original preprocessed file>",
  "originalT1ContrastAgentConfirmedBySourceDocumentation": true,
  "preprocessedSkullStrippedIsotropicN4RegisteredZNormalized": true,
  "publisherCheckpointTrainingOverlapIndependentlyExcluded": false,
  "originalRawDicomGeometryIndependentlyVerified": false,
  "publicLicense": "UCSF-BMSR noncommercial research",
  "publicDatasetURL": "https://imagingdatasets.ucsf.edu/dataset/1"
}
\`\`\`

The boolean claims must reflect **actual real source documentation and performed
preprocessing**, not guesses. The manifest does not authorize raw patient data.
Then run:

\`\`\`bash
python scripts/real-brain-mets-t1ce-qtim.py \
  --t1ce /scratch/authorized-public/t1ce.nii.gz \
  --manifest /scratch/authorized-public/source.json \
  --publisher-image qtim-brain-mets-original:research \
  --publisher-image-id sha256:<your locally observed verified image ID> \
  --output /scratch/new-numeric-brain-mets-evidence.json \
  --license-acknowledged --public-research-consent
\`\`\`

Optional \`--expert /scratch/authorized-public/exact-grid-binary-lesions.nii.gz\`
**only when the same preprocessed affine/shape and binary lesion label
definition are independently verified**. A skull-stripped T1 cannot be
automatically substituted for an unregistered full-brain MR or DICOM series.
No diagnosis, RANO response category, or treatment recommendations are
issued by this wrapper.

## Public expert research source

[UCSF-BMSR](https://registry.opendata.aws/ucsf-bmsr/) is a public-access-
controlled, **noncommercial no-redistribution** research MRI collection.
Its 560 MR scans from 412 patients have expert annotations of 5,136 brain
metastases. Download requires agreement to the source's terms, not credentials
stored in GitHub. The exact training overlap of the QTIM publisher's multi-site
model with any BMSR cases must be independently checked before claiming
unbiased validation. No export of licensed images or segmentation masks as
GitHub Actions artifacts.

Additional source: published QTIM README describes independent model cohorts;
that statement does **not** establish independent validation in Opus.

## State

| Acceptance | Status |
|---|---|
| Actual upstream code commit and published pretrained five-fold weights located | YES — code & official download links |
| Exact security-restricted GPU adapter and study-grid lesion measurements | IMPLEMENTED |
| Independent numeric and source/mask checks | TECHNICAL FIXTURES ONLY |
| Real downloaded checkpoint verified and model inference run by Opus | **NO** |
| Real source-positive metastatic lesion localized, expert Dice | **NO** |
| Expert reader clinical verification / Mac/browser patient mode | **NO** |

Next: original five fold image build on authorized GPU Linux, then a lawfully
accessed public T1CE scan with expert metastasis mask and source-geometry
registration. Model is not enabled in patient clinical mode.
