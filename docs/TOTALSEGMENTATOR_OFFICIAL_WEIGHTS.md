# Official TotalSegmentator CT fast archives (research preparation)

Pinned reference: TotalSegmentator 2.18.0, official upstream task 297 (3 mm)
and ROI-localization task 298 (6 mm), release tag v2.0.0-weights.

Verified release metadata at https://github.com/wasserth/TotalSegmentator/releases/tag/v2.0.0-weights:
- Dataset297_TotalSegmentator_total_3mm_1559subj.zip — 135386075 bytes.
- Dataset298_TotalSegmentator_total_6mm_1559subj.zip — 134827240 bytes.

Explicit opt-in (do NOT run on the 8 GB Mac during normal development):

```bash
python scripts/fetch-totalsegmentator-weights.py --research-download --output "$HOME/Downloads/opus-totalseg-research"
```

The command requires a new empty directory, checks file sizes and ZIP member
structure under bounded memory, reports SHA256 of actual downloaded archives,
and **does not extract** archives, install a package or execute any checkpoint.
It performs internet downloads only on direct user opt-in. No patient input.

The downloaded hash is **not independent official proof of weight authenticity**:
the official publisher's signed/hash manifest and licensing must still be
curated. No license token, personal paths or downloaded checkpoint is committed.
No network activity is allowed during eventual patient inference. For production
use the research archives alone are not sufficient authorization.
