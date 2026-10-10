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

Generated Emscripten codec modules (e.g. `@cornerstonejs/codec-charls`) contain
`require("fs")` in Node-only branches. Next.js 16 Turbopack resolves this
specifier when building browser chunks and would fail with
`Module not found: Can't resolve 'fs'`.

`web/next.config.ts` uses `turbopack.resolveAlias.fs.browser` to route this
browser-only import to the empty `web/lib/browser-fs.ts` module. Native
server-side `fs` resolution remains unchanged. This workaround does **not**
validate that JPEG-LS or other WASM codecs can decode all studies at runtime.

The GitHub Actions `web-checks.yml` job runs unit tests, TypeScript checks
and a production build after changes to the web app.

After updating the Mac, **restart** `npm run dev` for the config to apply.
If another missing Node module or codec error appears, capture its first error
and import trace; do not interpret a decoder failure as a negative finding.
