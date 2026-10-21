# Original AutoMSC prostate MRI tumor lesion coordinates

The opt-in original publisher model executor emits the mask in the same verified
NIfTI grid as the T2W source. The evidence now includes:

- `tumorVoxelBoundingBox`: inclusive index-space minimum/maximum for tumor label 2.
- `tumorCentroidRASmm`: mean of positive voxel centers transformed by the NIfTI affine.
- `tumorWorldBoundsRASmm`: three-axis extrema of **all** positive voxel
  centers transformed by the affine; this works with oblique/rotated volumes.
- `tumorVolumeMl`: voxel count times absolute affine Jacobian divided by 1000.

If no voxels are positive, the coordinates remain null. This is not evidence
of a negative diagnosis. The coordinates describe the research NIfTI space,
**not automatically an original DICOM series**: accurate overlay requires a
verified DICOM-to-NIfTI registration/voxel transform and viewer binding.

An original verified fold0 checkpoint and source-native forward are different
evidence milestones. No positive AutoMSC forward, PI-CAI external Dice or
clinical sensitivity has been established by this PR.
