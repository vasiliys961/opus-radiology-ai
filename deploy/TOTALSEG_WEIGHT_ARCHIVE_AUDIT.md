# Manual public checkpoint archive acquisition audit

From **GitHub Actions**, select **TotalSegmentator official weights audit (manual)**
and press **Run workflow** on main after this PR is merged.

The ephemeral GitHub-hosted runner downloads the two upstream release archives
(Dataset297 + Dataset298), compares expected archive byte sizes, records SHA256,
inspects ZIP structure and logs discovered nnU-Net plans/dataset/checkpoint paths.
It does not install PyTorch, extract weights, run medical inference, upload
artifacts, use patient data or require storage on the Mac.

Passing this test means those archived files were reachable and structurally
consistent at the time of download, **not** that they are independently signed,
license-approved, compatible with the current adapter, or clinically validated.
The checkpoints are removed at the end of the ephemeral workflow.

This is a mandatory prerequisite before designing the archive-to-model-cache
provisioning step; it exposes actual archive layout without making assumptions.
