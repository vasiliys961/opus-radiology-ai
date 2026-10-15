# LUNA16: real pretrained MONAI candidate-to-expert centroid comparison

This is NOT another 20-minute CPU model run. It uses the actual saved MONAI
RetinaNet 0.6.9 model output from [successful public Linux CPU Action
38436406805](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38436406805)
already committed as `web/public/examples/luna16-monai-cpu-run-38436406805.json`.

The clinical research question is **whether the model's already observed
real candidate center is near the independent LUNA16 radiologist-annotated
nodule center in the source study's actual physical coordinate space**.

One focused job:

1. Fetch the **immutable** annotated public LUNA16 `annotations.csv` (exact
   SHA-256) and original `.mhd` MetaImage header (exact SHA-256), without the
   57 MiB RAW pixels or any new model checkpoint/inference.
2. Fetch the pinned upstream MONAI inference configuration from its full
   pretrained model revision. Check that native raw LUNA16 ITKReader requests
   `affine_lps_to_ras=true`, and postprocessing
   `AffineBoxToWorldCoordinated` uses the same flag, which returns world
   LPS boxes as documented by MONAI's source transform.
3. Check original MetaImage physical origin, spacing, 3×3 direction,
   dimensions and each expert center's valid inverse source voxel indices.
4. Convert each saved MONAI *world LPS* candidate center into original
   MetaImage native voxel coordinates, compute Euclidean distance in mm
   to independently annotated expert center, and apply the LUNA16
   centroid/diameter-radius research rule at a declared score threshold of 0.5.
   Do NOT equate this to an expert voxel segmentation or clinical diagnosis.
5. Report matched/unmatched candidates, center errors, verified source/model
   SHA-256 and explicit null for clinical Dice, holdout validation,
   sensitivity, whole-cohort FROC and false positive rate.

The research report is emitted as an Action artifact and in its job logs.
No CT pixels or patient identifiers are uploaded. The source is an existing
publicly deidentified LUNA16 case and the model result already exists. **The
MONAI training used LUNA16, so this case cannot be assumed to be an external
unseen holdout.** A correct centroid match is evidence of functional
localization on ONE true CT, not a validated diagnostic performance claim.
No genuine ICH model result is inferred from this independent lung CT study.

## Source CT lesion marker in the research viewer

Once the page validates BOTH the original LUNA16 expert-reference response
and the saved real `0.884 mm` comparison result against the actual model
candidates and SHA-256-bound source files, the public MetaImage slice viewer
may mark the top real MONAI model center with a **solid magenta cross** on the
original 512×512 source RAW slice. The separate expert centroid/diameter is
the orange ellipse, not a segmentation mask. The highest-scoring model slice
is automatically selected after the browser locally verifies the entire
original RAW SHA-256. No patient CT upload or local Mac model computation.

Without validated geometric evidence, the viewer retains the old **dashed
magenta hypothetical** marker, explicitly does not assert source alignment,
and never upgrades imported arbitrary MONAI reports. The verified research
overlay is bound only to this exact public source/report/model checkpoint.

Source-voxel transformation is validated against published MONAI 1.4.0
world LPS conversion plus original MetaImage physical geometry. DICOM/SOP,
independent clinical contour validation, patient diagnosis, sensitivity and
FROC remain **NOT VALIDATED**.

## 3D candidate box on contiguous original CT slices

The physician research viewer also inversely projects the real MONAI 3D
`centerMonaiWorldMm` and `extentMm` model cuboid into a **bounded original
MetaImage voxel-space axis-aligned envelope**. All eight original world
box corners are transformed through the checked source physical 3×3
direction+spacing+origin; native x/y rectangle appears only on source z
slices intersecting that cuboid. A clinician may toggle the outline
independently of the model-center marker and compare neighboring slices.

**This cuboid is NOT a lesion segmentation, expert-measured diameter,
ellipsoid or measured nodule volume.** On non-axis-aligned source CT the
rectangle is a conservative native-voxel envelope, not a polygon-accurate
section of a transformed cuboid. Boxes are clipped to the original volume
and an explicit warning says when this occurred. The mark is solid only
for the exact independently verified real LUNA16 comparison; otherwise
it remains hypothetical and dashed. No patient or private scan registration
is inferred and no diagnosis/sensitivity number is generated.
