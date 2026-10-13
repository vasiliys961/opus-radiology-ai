# Real TotalSegmentator on PUBLIC LCTSC ZIP, original 103 DICOM frames

Use GitHub Actions **TotalSegmentator full public LCTSC ZIP CT (manual, experimental)**
on main after this PR is merged. This is a research-only opt-in experiment.

This uses our already-pinned LCTSC example from TCIA (CC BY 3.0), downloads the
actual public ZIP via NBIA API, verifies license, series identity, 103 DICOM
source-frame hashes and full content-chain SHA256, and packages every original
source slice as HU in native **512×512×103 float32 NIfTI** with 3 mm slice spacing.
Converter validates the final NIfTI SHA256 against the existing full-source
manifest, without artificial slices or resampling.

The runner first checks >=14GiB physical and >=12GiB available RAM, then
provisions official TotalSegmentator checkpoints, builds pinned CPU Docker,
runs trained inference without container network, and prints the output lobe
voxel count, qualityReview and verified mask digest. The model step is capped
at 38 minutes; job cap is 55 minutes. No CT, ZIP, checkpoint or mask is committed,
persisted as an artifact, or uploaded; cleanup runs even on failure.

Limitations: all 103 source slices are included, but complete lung coverage
is **not proven**. There is no independent reference lobe contour in this
workflow; therefore Dice is NOT measured. A successful result means technical
execution only, never diagnostic accuracy or authorization for patient data.
This runner is free only as permitted by current GitHub Actions plan/repo
limits. Resource availability and success are not guaranteed.
