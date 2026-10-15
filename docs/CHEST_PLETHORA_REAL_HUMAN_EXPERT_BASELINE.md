# REAL independent HUMAN pleural effusion benchmark: TCIA PleThora

This medical research milestone uses original, manually delineated and
radiologist-reviewed PleThora pleural effusion masks, **NOT synthetic models**.

Publisher: The Cancer Imaging Archive (TCIA), Kiser et al.,
[DOI:10.7937/tcia.2020.6c7y-gq39](https://doi.org/10.7937/tcia.2020.6c7y-gq39).
Original v3 source: published PleThora Effusions June 2020 ZIP,
[TCIA data page](https://wiki.cancerimagingarchive.net/pages/viewpage.action?pageId=68551327).
License **CC BY 3.0**, subject to TCIA data-use policy.
Original publicly published ZIP SHA-256 measured from real hosted download:
`5dd07c327fb5723c5bbb48f2a02d7f365513d3ad136811fbe4def330ef2d7f6a`.

The publication reports 78 cases with paired independent reviewer
pleural-effusion masks, and some third-reader annotations. The masks
were manually outlined and revised by radiologists. We did not claim
any model was run to generate these reference masks.

A separate bounded, successful, genuine Linux research execution
[Actions #38750003799](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38750003799)
downloads the author's original 2020 small effusion ZIP, validates
safe ZIP paths and selects the first deterministic pseudonymous
case with BOTH separately reviewed original masks. It verifies physical
grid identity to 0.05 mm, checks genuine binary labels 0/1 and computes
true expert-to-expert overlap on the ACTUAL NIfTI voxels.

**Genuine human-human result for ONE original PleThora study:**

| Measurement | Actually measured |
|---|---:|
| Original 3D grid XYZ | 512 × 512 × 134 |
| Expert mask 1 source voxels | 63,668 |
| Expert mask 2 source voxels | 54,206 |
| Expert mask intersection voxels | 52,625 |
| Expert mask 1 annotation volume | 182.15561 mL |
| Expert mask 2 annotation volume | 155.08461 mL |
| **Human-human Dice** | **0.89290259** |
| Original source index slices with disagreement | 62 |
| Pairs available in published archive | 78 |

This is **inter-reader overlap**, NOT TotalSegmentator Dice, false-positive
rate, test-set clinical accuracy, or a validated effusion model. One selected
case is not a cohort-wide performance statistic. This can help define
realistic benchmarks and reviewer adjudication policies for the next
pathology model.

Original model-free numeric artifact #11980541873; 1,737-byte JSON
SHA256 `50718acb2a3049266443b31addb46cb8e384daca34c73966420fee8c01b12e6d`.
Original ZIP of GitHub uploaded numeric-only artifact SHA256
`169b361d7a9539b85815e4733f0cfd9a231ea16d0f4c8fe2f589296983e682f1`.
The byte-identical physician source baseline JSON is preserved in
`web/public/examples/plethora-real-two-human-effusion-reference-run-38750003799.json`.
It is now reviewable inside the existing chest CT effusion research panel
after SHA proof. The entire real data computation ran on GitHub-hosted CPU,
not on the user's Mac. No original images, human masks or patient IDs
are embedded in git or research artifacts.

## Essential CT spatial caveat

As the official TCIA publisher warns, PleThora expert NIfTI masks use
**RPI orientation** while the corresponding NSCLC-Radiomics DICOM CT
uses **RAI orientation**. Even real expert masks must NOT be attached
to an original DICOM or current patient study simply because their
image dimensions match. The source CT case must be downloaded
separately under the CC BY rights and matched by unambiguous source
DICOM geometry, orientation transforms, content and patient/series identity,
before a genuine TotalSegmentator task315 inference can be compared.
The published masks can also deliberately exclude effusion areas that
overlap known radiotherapy GTVs. This affects apparent Dice and must
be documented per case.

Source CT DICOM images were NOT downloaded or used in the human-human
mask study, and no pretrained model was executed in it.
The next **clinical research milestone** is testing task315 on an
independent original NSCLC-Radiomics chest CT from the same published
PleThora case with independently verified physical registration and
then evaluating the actual model mask separately against both human
expert annotations. Only that can establish study-specific model Dice.
No patient clinical diagnosis or trial-level sensitivity is claimed.
