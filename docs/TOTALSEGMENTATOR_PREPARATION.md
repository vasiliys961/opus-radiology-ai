# TotalSegmentator: offline installation audit (not connected inference)

This first R2 preparation stage is independent of the R231 acceptance PR #35.
It adds a read-only audit; it does **not** expose another ready model or run,
install, download or send an image. MODEL-03 inference remains PLANNED.

## Scoped candidate

- Candidate package is pinned to TotalSegmentator 2.18.0 / Torch 2.6.0 in its
  separate opt-in requirements. No change to base install or Lungmask environment.
- First task plan: CT `total`, CPU `fast`, explicit five lung-lobe ROI names.
  Original class IDs 10–14 are preserved; these are not R231's right/left labels.
  Other modalities/tasks/unknown or duplicated ROI names refuse with unsupported.
- Fast uses a **3 mm inference model**, followed by required native-grid output.
  It changes model resolution; it is not an exact native-resolution algorithm.
- ROI localization also requires the **6 mm checkpoint Dataset298**, alongside
  Dataset297 for fast segmentation. Checking only one checkpoint is insufficient.
- This is anatomy, not nodule/pathology detection. Future abdominal/MR tasks need
  separate task dictionaries, weights, protocol/geometry and licence gates.

These details were inspected in the official upstream source at immutable commit
`3b9b7a1b2df13bacd1de41a8da2e8cdb6f13df5b`:
[task defaults](https://github.com/wasserth/TotalSegmentator/blob/3b9b7a1b2df13bacd1de41a8da2e8cdb6f13df5b/totalsegmentator/map_tasks_config.py),
[ROI localization and downloads](https://github.com/wasserth/TotalSegmentator/blob/3b9b7a1b2df13bacd1de41a8da2e8cdb6f13df5b/totalsegmentator/python_api.py),
[class dictionary](https://github.com/wasserth/TotalSegmentator/blob/3b9b7a1b2df13bacd1de41a8da2e8cdb6f13df5b/totalsegmentator/map_to_binary.py),
[configuration/telemetry](https://github.com/wasserth/TotalSegmentator/blob/3b9b7a1b2df13bacd1de41a8da2e8cdb6f13df5b/totalsegmentator/config.py).
Code/weights/version agreement and licence curation still require explicit audit;
package-version equality or a locally computed SHA does not establish trust.

## Read-only command

For an **already explicitly installed** optional environment and local model files:

```bash
python scripts/audit-totalsegmentator.py \
  --weights-root "$HOME/.totalsegmentator/nnunet/results" \
  --config "$HOME/.totalsegmentator/config.json"
```

No optional medical package import, Torch allocation or network operation occurs.
The report contains candidate task/label/spacing metadata, version-match status,
fixed relative model filenames, file size/SHA and telemetry state. Symlinks,
empty/oversized/changing files refuse. Hashing uses 128 KiB reads, never full
checkpoint buffers. Missing files are explicit; existing files stay
`present-unverified`. Config fields including licence token and home paths are
not exported. Local config is neither changed nor copied. `.env.local` is unused.
Successful audit exits zero even when assets are missing: this indicates completed
inspection, **not** readiness. Malformed/unreadable audit exits 2 with a fixed
technical error and `canRun=false`.

`canRun=false` and `adapterConnected=false` are intentional in this stage.
Upstream setup can download weights and enable usage telemetry; disabling a
config flag alone is insufficient for future hard offline inference. We must
curate official checkpoint hashes/licenses, prohibit all runtime downloads/network
in the isolated child, add resource admission/watchdogs and source-bound native
mask/Evidence/MPR checks, then run an authorized public reference and Mac benchmark.
No need to install or execute heavy nnU-Net on the user's M1 for this audit.

## Validation and limits

Tests cover CT/class dictionary and both required dataset IDs; unsupported MR,
restricted task, unknown/duplicate/wrong-type ROI; missing/version-mismatched
assets; bounded file hashes, symlink/empty-file refusal and no licence-token/path
serialization. All model files in those tests are synthetic, never trusted.
No actual TotalSegmentator checkpoint, output, MPS/GPU or medical accuracy was
verified. Existing R231/API/MPR components are unchanged. All four execution modes
and specialist/optional-LLM separation remain; patient/cloud gates stay closed.
