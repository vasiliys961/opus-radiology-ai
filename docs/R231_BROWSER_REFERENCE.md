# Actual R231 browser reference — partial CT, research only

This opt-in check exercises the **real trained R231**, direct browser uploads,
authenticated loopback worker and actual mask display in all three MPR planes.
Default CI/browser fixtures remain synthetic. No cloud model is required.

## Reference, selection and licence

Source: [TCIA LCTSC](https://www.cancerimagingarchive.net/collection/lctsc/),
Version 3, **CC BY 3.0**. The downloader also checks the live NBIA collection/licence
record before network download. It pins a content-hash chain over every original
DICOM file; archive timestamps are not the integrity criterion.

Required dataset attribution: Yang, J., Sharp, G., Veeraraghavan, H., Van Elmpt,
W., Dekker, A., Lustberg, T., & Gooding, M. (2017). *Data from Lung CT Segmentation
Challenge (LCTSC) (Version 3)* [Data set]. The Cancer Imaging Archive.
[DOI: 10.7937/K9/TCIA.2017.3R3FVZ08](https://doi.org/10.7937/K9/TCIA.2017.3R3FVZ08).
Related challenge: [10.1002/mp.13141](https://doi.org/10.1002/mp.13141).
TCIA archive: Clark et al. (2013),
[10.1007/s10278-013-9622-7](https://doi.org/10.1007/s10278-013-9622-7).
Licence: [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
Model weights have a separate licensing boundary; this does not grant commercial
R231 weight clearance. See [worker guide](LOCAL_LUNGMASK_WORKER.md).

The complete source series has **103 native 512×512 CT slices**. The test selects
**32 consecutive central slices, indices 35–66 (zero based)**. Each selected DICOM
file is byte-for-byte unchanged. There is no resampling, in-plane pixel crop,
repeated slice or synthetic medical prediction. Native spacing is
**0.976562 × 0.976562 × 3 mm**; selected slice centres span z=145–238 mm in LPS.
**This is a partial CT slab, NOT complete chest coverage or full lung volume.**
The app now visibly states that mask volume refers only to loaded slices.

The full 103-slice series exceeds the unchanged 8,388,608-voxel AI cap. Selection
is explicit in the downloader, manifest and report; it does not pass full-chest
R1 acceptance. RTSTRUCT ground truth exists in this collection but was **not**
loaded or rasterized by this test: **clinical Dice is null**, not invented.

## Reproduce locally

First install the optional pinned environment/checkpoint using
[LOCAL_LUNGMASK_WORKER.md](LOCAL_LUNGMASK_WORKER.md). Existing default paths:
`.venv-lungmask/bin/python` and `$HOME/Models/Opus/unet_r231.pth`.

From the repository root:

```bash
bash scripts/test-r231-browser.sh --download-public-reference
```

This downloads only the pinned public reference into a new Downloads directory,
builds the browser app, installs Chromium and runs the real check. It never
installs Torch or downloads weights automatically; it never changes `.env.local`.
Override existing paths with `OPUS_LUNGMASK_PYTHON`, `OPUS_R231_WEIGHTS` or choose
a new external output directory with `OPUS_R231_REFERENCE_RUN`. Reference files
remain local for manual inspection; no source images/screenshots are committed
or uploaded as CI artifacts. Report contains only technical hashes, geometry,
runtime, counts and explicit coverage limitations. It never contains bearer
tokens, raw SOP/patient tags or source pixel arrays.

Lower-level commands used for the actual Linux check:

```bash
python scripts/download-r231-browser-reference.py --download-public-reference \
  --output /outside/repo/reference
node scripts/check-r231-browser.mjs --python /path/to/optional/python \
  --weights /path/to/verified/r231.pth --reference /outside/repo/reference \
  --report /outside/repo/metrics.json
```

Previously downloaded archives can be verified with `--archive /path/reference.zip`
instead of downloading again. New external destination required; arbitrary ZIP
paths are never extracted. The browser check rechecks the pinned selected-file
hash chain and expected NIfTI digests before trusting the prepared manifest.

## What the check proves

* Actual public DICOM files enter Cornerstone and MPR. Their decoded full scalar
  NIfTI bytes match an independent pydicom calculation for signed z ordering and
  exact float32 RAS sform, including IEEE signed zeros. No windowed PNG is input.
* 257 acknowledged blocks upload **33,554,784 bytes**, including NIfTI header.
* The installed official R231 runs in a separate offline CPU inference process;
  model SHA, request/source/input/mask binding and geometry are verified.
* Both lung labels are present and nontransparent mask pixels appear on all
  three actual MPR canvas planes. This is an engineering rendering check,
  not expert review of segmentation accuracy.
* Worker DELETE is followed by GET 404. Browser page requests are confined to
  two loopback origins; this interception is not an OS network sandbox.

Status/mask replies are **relayed unchanged from the real worker** for independent
byte inspection because Chromium can evict response bodies during streaming.
No response is fabricated and no inference is mocked. Browser timings include
this test instrumentation; controller/relay memory is not a production browser
benchmark. Chromium's software renderer in Linux is not Safari on Mac.

## Actual verified result

Baseline: main `cfacb95e4610cb1d9e1bc15c1edf6b9bdad4f34c` (PR #14 merged), both
[Web](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38154456118) and
[Python](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38154456122)
checks passed before implementation.

[Machine-readable verification](verification/r231-browser-linux.json), Linux
x86_64 / Torch 2.6.0+cpu / Lungmask 0.2.20 / Chromium 134:

| Measurement | Observed |
|---|---|
| Actual selected input | 512×512×32; partial native CT |
| Inference + postprocessing | 21.582 s |
| Adapter total | 23.117 s |
| Model process peak RSS | 820.08 MiB, getrusage high-water fallback |
| Browser job including preparation/upload/poll/import | 30.595 s |
| Import to ready MPR | 2.910 s |
| Label voxels: background / right / left | 7,703,880 / 337,031 / 347,697 |
| Rendered mask pixels: axial / coronal / sagittal | 4,122 / 3,658 / 119 |
| Clinical Dice; full chest; M1/Safari/system RAM | Not evaluated |

Counts and pixel tallies are reproducibility evidence, not ground truth accuracy.
Full-resolution complete-chest processing, bounded whole pipeline, total RAM and
pressure on Mac M1/8GB, actual Safari, clinical validation and licence clearance
remain pending. **R1 remains PARTIAL.** The four modes and optional Gemini/Claude
via Evidence remain the architecture; local patient, remote and patient-cloud
gates stay closed.
