# Cornerstone3D laboratory viewer (v0.4)

**Status: experimental, not clinically validated.** This feature lives at `/viewer` and does **not** replace the limited but tested v0.3 reader on `/`.

## Implementation

- **Matching, pinned versions:** `@cornerstonejs/core@4.18.3`, `@cornerstonejs/dicom-image-loader@4.18.3`, `dicom-parser@1.8.21`. No code copied from Doctor Opus' Cornerstone 2.x legacy integration.
- Client-only imports after mount; only local `File` objects are passed to `wadouri.fileManager.add`, not a backend or external URL.
- `RenderingEngine` + `ViewportType.STACK`: 2D navigation, keyboard/slider/wheel and fit/reset controls.
- DICOM Part 10 headers are indexed locally; slices grouped by Study/Series/FrameOfReference UID, and ordered by DICOM physical position when validated by the existing geometry code.
- `maxWebWorkers=2` to reduce memory pressure on 8 GB MacBook Air M1.
- Constraints: at most 300 files, 1 GB total, 128 MB per file; actual runtime memory use may be significantly larger than input bytes and **these guards are not sufficient for arbitrarily large frames**. Run with synthetic data; monitor Activity Monitor.
- The loader registry is released on component unmount; no repository contains images, metadata dumps, or patient records.

## Validation status

- Existing 20 unit tests plus 6 memory-boundary tests pass with Node 22.
- **Requires integration testing on the user's Mac:** `npm install`, `npm run typecheck`, `npm run build` and manual `/viewer` test, particularly Safari decoding workers and WASM codecs.
- No claim that JPEG2000, JPEG-LS, RLE, enhanced multiframe or color images are validated. A failed decoder must surface an error, never a diagnostic interpretation.
- Browser support and codec worker path depend on bundler. If Safari shows a WASM-worker error, capture terminal and browser developer-console details; do not assume the image is empty or clinically normal.

## Next milestones

1. Validate Cornerstone3D StackViewport on Mac with synthetic uncompressed and representative compressed DICOM test sets.
2. Handle Part 10 files with complex sequences and study grouping through a standards-aware parser, with explicit warnings for incomplete header reads.
3. Add display-level cine/WW-WC/pan/zoom controls using the supported current Cornerstone tools API, with frame-index tests.
4. Only after geometry gates and independent imaging QA: calibrated measurements, MPR/3D and DICOM SEG overlays.
5. Keep all AI findings separate from original pixel data; later bridge to FastAPI inference as opt-in.

## Notes from Doctor Opus audit

The original `DicomViewer.tsx` imports legacy `cornerstone-core` and references an unimported `cornerstoneWADOImageLoader` symbol. Its older worker initialization, 12-frame subsampling and client-side raster export are **not** suitable for faithfully rendering entire studies or voxel-space AI. The new viewer is an independent implementation based on current Cornerstone APIs; this repo does not change Doctor Opus.

## Next.js 16 / Turbopack: browser-only `fs` shim

Generated Emscripten codec modules (e.g. `@cornerstonejs/codec-charls/dist/charlswasm_decode.js`)
include `require("fs")` in their **Node-only** branches. Turbopack attempts to resolve that
specifier while bundling for the browser, producing `Module not found: Can't resolve 'fs'`.

`web/next.config.ts` now uses `turbopack.resolveAlias.fs.browser` to redirect this
**browser-only import** to empty `web/lib/browser-fs.ts`. The server-side `fs` module
remains available. This is a bundling compatibility shim, **not** a filesystem polyfill
or proof that all JPEG-LS/JPEG2000 decoders work at runtime.

The GitHub Actions `web-checks.yml` job runs unit tests, TypeScript checking, and
`next build` so this class of compile failure is easier to catch before deploying.

On a Mac after pulling, restart Next.js; changes to `next.config.ts` require a restart:

```bash
cd ~/Desktop/opus-radiology-ai-github
# in the other terminal, stop npm run dev with Control+C first
git pull --ff-only
cd web
npm run typecheck
npm run dev
```

If the browser reports another missing Node.js module or the viewer crashes after
uploading DICOM, capture the first error and its import trace; do not assume that a
successful build establishes decoder compatibility or clinical image fidelity.

## v0.6 — индексатор сложных DICOM

При загрузке серий с последовательностями `SQ` неопределённой длины или DICOM без
`DICM`-префикса прежний учебный парсер мог отказать на всех срезах. Для таких
файлов используется `dicom-parser` (уже существующая зависимость), с остановкой
перед Pixel Data и последовательным ограниченным чтением не более 8 МБ на файл.
Ошибки выводятся с подсчётом наиболее частой причины без раскрытия метаданных.

Поддержка индексации **не гарантирует** воспроизведение изображения: возможность
декодировать исходный Transfer Syntax (особенно raw и сжатые файлы) ещё должна
проверяться отдельно на Cornerstone3D в Safari. Никаких внешних загрузок нет.

## v0.7 — display-only imaging tools

The same `CornerstoneStack` powers both the unified dashboard `/` and the lab `/viewer`.
The toolbar adds zoom (25–800%), pointer pan, drag-to-adjust WW/WC, precise
WW/WC inputs, CT-only brain/soft-tissue/lung/bone presets, fullscreen with
Safari WebKit fallback, and responsive canvas resizing. The original DICOM
buffers are never modified and no image is sent to a server. MRI does **not**
show HU presets; its numeric display intensities have no universal HU scale.

Wheel navigates slices and Shift+wheel zooms. These are **display controls, not**
validated calibrated image measurements. Screenshot or displayed brightness
must not be used for automated numerical inferences. The viewer maintains
`window-level.ts` helpers with 5 unit tests; model inference remains disabled.

On 8 GB Mac hardware, start testing with the user's known 20-frame subset;
then try the full anonymized 135-file multi-series dataset. Fullscreen and
worker decoding must be verified in Safari; unit tests cannot validate GPU
rendering, modality LUT fidelity or pixel geometry.

## Experimental MPR (v0.8)

- Same three-column dashboard; default is the previously validated 2D stack. A distinct **MPR · 3 плоскости** toggle enables patient-space axial/coronal/sagittal Orthographic volume viewports.
- Strict preflight from `web/lib/mpr-eligibility.ts`: full series `volumeReady`, consistent pixel matrix and frame count, <=200 files, <=48 MiB assumed 16-bit pixels, <=256 MiB total input. Only after explicit user action is volume data decoded.
- The local file manager hands image IDs to Cornerstone; `loadAndCacheImage` of each instance populates metadata, then `volumeLoader.createAndCacheVolumeFromImages` creates a volume. `setVolumesForViewports` assigns the same volume to three orthogonal orientations. This may need further tuning on Safari.
- Cleanup releases rendering engine, volume cache, image cache and file manager entries. A failure is reported, never silently interpreted as a normal image.
- Reconstructed planes are *experimental*. Geometry checks cannot guarantee clinical accuracy; no measurements, segmentation, export or diagnosis. Real Mac/Safari MPR runtime remains unverified until user smoke test.
- The original `/viewer` diagnostic lab and standard DICOM stack remain available as fallback.


## Interactive MPR navigation (v0.9)

- Orthogonal viewports are now linked by a **single physical (patient-space) crosshair point**.
- Wheel, arrow keys, +/- controls and per-plane slider navigate each volume viewport with Cornerstone `utilities.scroll` and `getVolumeViewportScrollInfo`; index ranges are taken from the actual viewport, not guessed image orientation.
- Clicking an image maps the canvas coordinate to patient space via `viewport.canvasToWorld`. Points outside the volume index extent are rejected. The other two viewports then align their clipping plane through the selected point.
- Crosshairs are a visual research aid, **not a calibrated measurement**. No positions are saved or transmitted.
- Geometry helpers have isolated unit tests; validate mouse/slider/crosshair synchronization, edge slices, resizing and GPU memory in Safari.
- The M1 memory preflight and 2D fallback remain mandatory.

## v1.1: experimental 3D maximum-intensity projection (MIP)

- The opt-in panel under the three MPR views uses a `VOLUME_3D` viewport and
  Cornerstone's `MAXIMUM_INTENSITY_BLEND` against the **existing cached** volume.
  The rendering is a ray-projection through the voxels, NOT segmentation, a
  mesh, calibrated volume measurement or clinical 3D anatomy.
- Camera can be rotated with the pointer or buttons. Hiding the panel removes
  its GPU viewport. Existing conservative RAM/geometry checks still gate MPR.
- Large between-slice gaps (e.g. 4.5 mm in an MRI acquired as 20 slices) are
  explicitly warned about. Reconstruction/interpolation cannot reconstruct
  missing anatomy, and intensity MIP may obscure low-intensity tissue.
- Fixed a legacy CSS selector applying fixed image heights to MPR control rows.
- Safari rendering, device memory, WebGL context-loss behavior and image fidelity
  are still UNVALIDATED and require manual tests on non-identifiable datasets.


## v1.3: Composite volume rendering (research only)

The same GPU volume is shared by MPR and 3D, and may be rendered as
`BlendModes.COMPOSITE` using an interactive grayscale color-transfer function
and piecewise opacity curve, or `MAXIMUM_INTENSITY_BLEND`. The display mapping
uses each volume's numeric scalar range and is not an anatomically trained
segmentation or a tissue classifier. The controls do not modify original DICOM
pixel data. MR pixel intensities have no universal tissue thresholds.
The 3D panel retains a clear warning for anisotropic source geometry;
the GPU renderer cannot infer missing structural detail between 4.5 mm slices.
The M1 memory budget and fail-closed DICOM preflight remain unchanged.

## v1.3.1 — 3D intensity range Safari runtime fix

Cornerstone3D 4.x `IImageVolume.imageData` does not provide a VTK
`getPointData().getScalars().getRange()` chain. The earlier Composite
renderer incorrectly called that chain and failed on an otherwise valid MR
series. The correct source is `volume.voxelManager.getRange()`;
`getMinMax()` is a defensive fallback. No full scalar buffer is allocated.
Range values are actual voxel intensities, not a tissue classifier.
There are unit tests for both paths and invalid data.
