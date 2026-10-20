# Original WMH FLAIR fold-0: source-grid expert overlap

The original pretrained `wmh_seg==1.6.0` fold-0 research CPU runner
(`scripts/real-brain-flair-wmh-cpu.py`) can **optionally** evaluate its
real inference output against the corresponding original expert WMH NIfTI.

## Required evidence

- Original source FLAIR, source SHA-256, published source URL and source licence.
- Original fold-0 model directory with author SHA-256 (no downloads in worker).
- Original expert annotation from the **same** 3-D native source grid; byte SHA-256.
- Confirmed FLAIR protocol, explicit approved-public-research and isolated worker.
- No private data, model weights, source MRI, expert labels or per-subject identifiers in CI artifacts.

After the normal runner arguments, append
`--expert /private/research/wmh.nii.gz --expert-sha256 <64-character digest>`.
The CLI requires both arguments together. The external trained model must
complete its actual forward before any TP/FP/FN/Dice are calculated.

## Labels and clinical interpretation

The WMH Challenge annotations may contain label **0** (background), **1**
(WMH) and **2** (other pathology). Label 2 is *excluded* from accuracy
denominators, separately counted, and never misrepresented as negative.
Unexpected annotation classes, floats, checksum/affine/shape mismatches,
empty-positive expert and nonbinary predictions all **fail closed**.
No spatial resampling is used to artificially improve overlap. The report
contains integer TP, FP, FN, TN, WMH Dice, sensitivity, precision and
ignored-label count. Reading and scoring are slice-bounded.

This remains **single-case research overlap**, not independent validation
unless case-level training exclusion, source annotation provenance and
representative external evaluation have been established.

### Actual data limitation, 20 October 2026

`MedOtter/wmh-segmentation` contains **real compressed NIfTI** below
`dataverse_files/` (about 399 MB total). The failed workflow
#39430837434 mistakenly used the `data/nii/WMH_Segmentation_Challenge/`
prefix from JSONL paths, rather than the actual Hugging Face repository tree.
The test Singapore/85 pair is about 2.51 MB; the corrected source admission
downloads and hashes those exact files at a pinned dataset revision.
Some masks in this mirror have had their NIfTI header sform updated, so its
bytes are not necessarily identical to the original archive.
Its CC-BY-4.0 metadata must not override original rights.
Original WMH Challenge dataset:
[DataverseNL DOI 10.34894/AECRSD](https://doi.org/10.34894/AECRSD);
the original complete Academic Torrents archive is about 8.72 GB and
lists **CC BY-NC 4.0**; evaluate upstream terms before use.
Do not claim original FLAIR admission or Dice from metadata alone.

The automated GitHub PR workflow tests only synthetic numeric geometry;
it **does not** download the source MRI, model or run original inference.
