# Source-bound lobe navigation for research-only TotalSegmentator MPR

After the real 103-slice CT → 32-slice native mask → Chromium MPR pass
([run 38353633892](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38353633892)),
the existing explicit `.nii` + JSON research import can now derive a small
five-record observation list directly from occupied mask voxels.

Each labeled lobe gets: its research name, voxel count, **partial slab** volume,
occupied bounding voxel range, original slice range, and a real **occupied**
mask voxel near the label centroid. A physician may jump to that location in
all three MPR planes and inspect the actual DICOM overlay. The code runs in
bounded chunks with cancellation checks; it makes no additional mask copies,
uses no API tokens and performs no inference.

Missing labels stay marked for review; zero area is never "normal". The
position is a segmentation navigation anchor, **not** a lesion location or
clinical finding. No Dice, verified patient identity, clinical safety or
M1/Safari production acceptance is implied. Patient cloud mode remains blocked.
