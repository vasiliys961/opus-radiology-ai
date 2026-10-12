# Optional GitHub Actions build smoke test

The manual workflow **TotalSegmentator server image smoke (manual)**
builds the actual Linux CPU Docker image on a GitHub-hosted runner; it then
verifies installed PyTorch/TotalSegmentator package versions and tests that
the CLI refuses to run without explicit research confirmation. Both runtime
checks have **no network**, weights, CT files, credentials or clinical data.
The build itself requires internet to fetch dependencies and can consume
substantial GitHub Actions resources, so it is **manual-only**, not run on
every commit. The workflow does not prove model checkpoint integrity, a
successful CT inference, memory use, or clinical performance.

After merging, open GitHub Actions, select the named workflow, then Run workflow.
A successful smoke establishes that the exact committed image built and its
dependency/CLI tests passed on that GitHub runner at that time.

Do not mistake image-build success for a validated TotalSegmentator deployment.
