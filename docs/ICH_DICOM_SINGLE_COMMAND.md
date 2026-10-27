# Original NCCT DICOM → real ianpan ICH model → source-slice Evidence (research)

This increment executes **the existing original pretrained ianpan inference**, not an artificial substitute or imported JSON. It is designed for **approved public, fully reviewed, deidentified axial noncontrast head CT** on an isolated Linux machine with at least **10 GiB available RAM**. It is not a clinical workflow, a browser worker, or a Mac M1/8 GiB task.

One command combines:
1. The existing strict per-DICOM-SHA authorization and original pixel-to-HU conversion (`prepare-ich-public-dicom-hu.py`).
2. The existing original ianpan/Safetensors pretrained runner (`run-ianpan-ich-research.py`), with all publisher model asset digests verified, authentic model forward and native NIfTI ROI projection.
3. Ordered original DICOM slice SOP binding and research-only `opus-evidence/v1` finding export. Nonlocalizable heatmaps are not promoted. No 3D hematoma size or negative diagnosis is invented.

## Invocation on a separately provisioned research host

Use precisely the public rights/source-SHA manifest described in [ICH_PUBLIC_DICOM_HU.md](ICH_PUBLIC_DICOM_HU.md). The original [ianpan model files](https://huggingface.co/ianpan/ct-head-hemorrhage-detection) must be available at the pinned revision `e6d89c2` (or explicitly download publisher assets with `--download-pretrained`, checked by their exact SHA). Keep original DICOM and the resulting Evidence **outside GitHub and outside cloud providers**.

```bash
python scripts/run-public-ich-dicom-evidence.py \
  --dicom-dir /approved-public-ct/dicom \
  --public-manifest /approved-public-ct/authorization.json \
  --model-dir /isolated-models/ianpan-ich \
  --output-dir /isolated-output/fresh-public-case \
  --device cpu \
  --authorization PUBLIC-HEAD-NCCT-RESEARCH-OK
```

The newly created output directory is private. `private-native-evidence.json` contains original source SOP Instance UIDs and **must never be checked into Git or copied into issue comments/CI logs**. Separate numerical result count may be logged; patient/series identifiers and pixel arrays are not printed by the orchestrator.

This source linkage is established in the local research executor on compatible real DICOM input, but does **not** connect to the browser unified-start button; the ICH model is not installed inside the current loopback R231 worker. No real user-selected DICOM study has yet passed through this new combined command. There is no independent clinical sensitivity/Dice established by this integration.


## Physical slice identity

For every model ROI the executor now verifies the original NIfTI RAS affine and
the projected native voxel bounding box, converts its four corners to DICOM LPS,
and matches one **unique physical DICOM image plane** using original
ImagePositionPatient, ImageOrientationPatient, PixelSpacing and image dimensions.
It rejects outside-FOV, discrepant ROI world coordinates, unknown slice geometry
and ambiguous co-planar images. The model's NIfTI k value is *not* treated as an
index into a DICOM filename/SOP array. All original DICOM SHA digests are
rechecked after inference, as is the converted source NIfTI digest. CI includes a
reverse-order test but remains synthetic; a real positive licensed case is
still necessary for acceptance.

## Acceptance

- The default CI exercises converter geometry and synthetic binding safety contracts, **not** original model forward.
- Real acceptance requires a lawful positive **public** NCCT, this exact combined command succeeding with original trained weights, native SOP-linked Evidence and independent expert positive comparison.
- Then implement a separately provisioned approved worker session and browser streaming for the currently opened study. Do not register ICH in `installed-detector-registry.ts` on the strength of a research JSON file.
- Gemini/Opus requests retain all their existing image privacy, authorization and budget gates.
