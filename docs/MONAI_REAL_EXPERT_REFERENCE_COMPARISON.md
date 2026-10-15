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
