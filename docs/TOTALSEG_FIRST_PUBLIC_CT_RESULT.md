# TotalSegmentator — first genuine public CT execution (2026-10-13)

[Successful manual GitHub Actions run #38345843854](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38345843854)
actually invoked trained TotalSegmentator CPU weights on the upstream public example CT.
The installed checkpoint provisioning, offline Docker inference, native mask
verification and source SHA binding all returned success. The experiment used
**122 × 101 × 30** native voxels, **not a complete diagnostic chest CT**.

Elapsed model-wrapper time: **26.52 seconds**; mask SHA-256 is recorded in
`docs/verification/totalseg-first-public-ct.json`.

**Important QA:** only 3 of 5 requested lung-lobe labels were present.
Upper/middle right lobe labels (IDs 12 and 13) contained zero voxels.
This is a `requires_review` signal. It is NOT proof of disease, missing
anatomy, or algorithm failure: the example is only a reduced CT volume and
its anatomical coverage is not independently certified.

There is no reference contour and therefore **no Dice score** and no claim
of real diagnostic accuracy. The workflow intentionally deletes NIfTI/weights
on runner teardown, and does not expose private DICOMs or PHI.

Next scientifically meaningful work is a legally cleared full chest CT with
known coverage, independent reference masks and Dice/lobe-wise QA. Preserve
the existing research-only/patient-blocked gates. This is **a technical
execution milestone**, not MODEL-03 clinical or browser integration acceptance.
