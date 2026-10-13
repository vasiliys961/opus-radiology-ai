# TotalSegmentator real lung lobes → native 32-slice MPR mask (engineering)

Verified public model run: [GitHub Actions 38349118315](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38349118315).
Its complete CT size is 512×512×103, which is **larger than** the current
M1/browser label-mask bound of 8,388,608 voxels.

The script \`scripts/extract-totalseg-mpr-slab.py\` uses a SHA-bound existing
**real TotalSegmentator full mask and report**, verifies NIfTI dimensions,
uncompressed uint8 type, sform geometry, mm units, and five allowed labels,
then extracts 32 unchanged consecutive slices. It shifts the spatial affine
origin by the exact original start-slice offset; it does **not** resample,
invent slices, change labels or imply whole-lung coverage.

The resulting ~8MiB mask can be imported with the viewer's existing
**Загрузить маску .nii** function *provided that the matching 32 original
DICOM slices are loaded*. That DICOM selection is indexed 35..66 on the
pinned public LCTSC reference. A mismatched study must be rejected by the
existing geometry checks in MPR.

In a private research workspace after generating a full native mask and
report (never using patient images in public GitHub Actions):

    python scripts/extract-totalseg-mpr-slab.py \
      --mask /research/full-totalseg-mask.nii \
      --report /research/full-result.json \
      --output /research/lctsc-mpr-slab.nii \
      --manifest /research/lctsc-mpr-slab.json \
      --start 35 --count 32 \
      --expected-source-sha256 99615ddb66e09bd46c2ff70c352d73414285145b358e448682b7cffc41249738

The new opt-in full-public-CT workflow will perform this extraction on the
ephemeral GitHub runner and only print its **technical summary**, without
publishing pixels, label masks, or patients' data to GitHub artifacts.
The masks are deleted after every run. For manual visual review, run the
same extraction in your own appropriately provisioned research environment.
Full-anatomy Dice, independent contours, pathology detection and clinical
acceptance remain NOT validated. No unsupported 103-slice M1 browser allocation.
