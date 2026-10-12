# Opt-in public CT inference on free GitHub Actions runner

This manual workflow runs trained TotalSegmentator (not only installation)
on the public TotalSegmentator example CT published at
`wasserth/TotalSegmentator/tests/reference_files/example_ct_sm.nii.gz`
(cited as an example in NIH Biowulf documentation).

It fails closed if the free GitHub runner reports insufficient RAM, the
upstream fixture is missing/too large/incompatible with the NIfTI preflight,
checkpoint acquisition/build fails, inference exceeds the 38-minute
model-step limit, or native-grid/lobe label checks fail.

**This is experimental; no successful model run is claimed until the manual
workflow actually finishes green.** The runner has no GPU and only a
limited RAM allowance; being free does NOT guarantee successful inference.
No uploads of weights, input CT or masks are configured. Network access
is used for public asset download and Docker dependency build; the Docker
inference container itself uses `network_mode: none`.

After merging select **TotalSegmentator public CT real inference
(manual, experimental)** under Actions and Run workflow on main.
Failing results are useful diagnostics for a dedicated server; clinical
validity and reproducible Dice benchmarking require separate work.
