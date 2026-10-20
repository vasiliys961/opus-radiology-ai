# Abdomen: stomach, gallbladder, liver, spleen, pancreas, kidneys/adrenals

New **real quantitative medical anatomy postprocessor**, not a new lesion
model. Executable `scripts/real-abdomen-organ-anatomical-volumetry.py`
consumes already-generated pretrained TotalSegmentator 2.18.0 `total`
anatomy masks on an ORIGINAL public/deidentified licensed CT in exactly
matching native NIfTI physical-mm coordinates.

Supported original free TotalSegmentator task names: stomach, gallbladder,
liver, spleen, pancreas, left/right kidney and left/right adrenal gland.
Input source CT and each mask are hashed and validated against the
same native shape and affine; the common existing source-bounded,
small-eight-slice block reader is reused from the cardiac/vascular
research utility. No extra 3D full volume memory conversion.
Outputs include 3D source-voxel inclusive boxes, anatomical source RAS
centroids and estimated **segmentation-mask volume in mL**, while
explicitly warning partial organ coverage has NOT been independently
confirmed. Empty masks are not normal anatomy nor a pathology negative.
When liver and spleen masks both exist and neither touches volume edges,
the code also reports the *numeric* spleen/liver anatomical-mask volume
ratio, not a portal hypertension or cirrhosis diagnostic score.

Example after independent legitimate pretrained anatomy inference:

    python3 scripts/real-abdomen-organ-anatomical-volumetry.py \
      --ct /public/original_abdominal_CT.nii.gz \
      --ct-sha256 <exact_original_source_SHA256> \
      --mask liver=/segmented/liver.nii.gz \
      --mask spleen=/segmented/spleen.nii.gz \
      --mask stomach=/segmented/stomach.nii.gz \
      --mask gallbladder=/segmented/gallbladder.nii.gz \
      --public-source-url https://verified_public_license_source \
      --public-source-license 'specific source permissions' \
      --approved-public-research --output /isolated/new-abdominal-numeric.json

The stomach model mask includes organ wall plus cavity — NOT validated
gastric contents or wall thickness. A **gallbladder mask cannot discover
radiolucent stones**, a liver mask does not diagnose cirrhosis, a kidney
mask does not identify tumor, a pancreas mask does not identify cancer,
and an adrenal mask does not detect adrenal incidentaloma. Ascites,
gastric mucosal malignancy, lymph nodes and portal vessel thrombosis are
NOT covered by this anatomy-only module. Stage conditions remain research
only without completed clinical model calibration or source DICOM SOP mapping.

Green CI checks synthetic-source geometry and numeric correctness, **not**
a new genuine external pretrained TotalSegmentator model run. Next stage:
combine lawful original CT and authentic pretrained organ masks, evaluate
physical volume against expert masks, confirm full organ coverage and
connect to exact-source MRI/CT numeric viewer. Never upload patient CT,
masks or identifiers to an external LLM. CPU worker optional/off by default.
