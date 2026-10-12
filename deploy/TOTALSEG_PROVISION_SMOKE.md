# Real checkpoint extraction smoke test (manual)

After merging, go to GitHub Actions and select
**TotalSegmentator real weights provisioning (manual)** on `main`.

This workflow downloads both upstream model archives and runs the actual
offline provisioning code from PR #53. It checks extracted JSON metadata,
actual checkpoint file sizes, and SHA-256 for each required nnU-Net model
file. It then deletes all archives and weights from the ephemeral runner.

There is no patient data, PyTorch inference, public model publication, or
workload on the user's Mac. A green result demonstrates installation and
file integrity **only**. It does not establish external signature provenance,
license clearance, model runtime correctness, or diagnostic validation.
