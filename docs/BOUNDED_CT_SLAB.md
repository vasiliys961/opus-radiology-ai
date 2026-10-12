# Bounded native CT slab — 2026-10-12

Baseline main `22dc41b` has PR #31 merged and green Web Actions. PR #32 (usage)
is still a separate unmerged draft; this branch starts from main, not from it.

## Working behavior

The existing viewer now lets the operator explicitly choose consecutive native
CT slices for MPR and the local R231 action. Original files remain in the full
2D stack. Selection is metadata/File references only, not pixel copying,
resampling, interpolating or altering DICOM. No volume is decoded before applying
the selection. Unchanged resource checks run before rendering the selected grid.

The maximum is the minimum of 32 slices, the existing 8,388,608 voxel limit,
48 MiB raw MPR limit, file count and a proper subset of the source series.
512x512 supports at most 32 slices; 1024x1024 at most 8. Three slices are required.
The entire original series must have verified uniform spatial geometry. It is
rechecked on apply, including order; one bad slice outside the chosen range
cannot be hidden by selecting a valid-looking part. MR, multiframe, malformed
ranges, missing files and the existing 256 MiB MPR input ceiling fail closed.

Both the sidebar and MPR show the exact interval and original frame count, with
explicit partial coverage. The selected native SOP references and shifted LPS
origin reach scalar export/streaming, SHA binding and local worker/mask handling.
The Python v1 request contract is unchanged: frameCount is selected depth,
coverage remains not-confirmed. A full-series mask cannot be applied to the slab.

Range edits require returning to 2D; old MPR/masks/jobs are torn down first.
Returning to the full series clears selection and shows all slices in 2D.
Source replacement invalidates the selected range. A fresh MPR has no old
package/mask/reviewer state. 2D cleanup now removes only its owned decoded image
cache entries (which also decache loader datasets), including late completion,
in addition to the owned file registry. This avoids retaining the old 2D cache
while the selected MPR allocates; it is not a measured whole-system RAM claim.

## Verification

260 unit tests, typecheck, production build and synthetic Chromium. Unit tests
cover a metadata-only 512x512x103 CT refusing full MPR but accepting exact 32
native slices; adaptive limits; ranges/resources/parent geometry; distinct SOP
identity; exact shifted LPS, scalar SHA and stream/full-buffer agreement.
Browser verification uses a small mathematical 64x64x32 CT, selects 7-14 (8
slices), checks every scalar against independent physical-coordinate formulas,
checks SHA/header/depth, refuses the full mask, exercises actual browser job and
chunk code with a mocked worker/result in three MPR planes and DELETE, then
returns to full 2D/MPR with no stale mask. No trained inference or paid calls.

## Acceptance boundary

This is a usable bounded partial slab, NOT full chest segmentation or tiled
whole-lung aggregation. R231 postprocessing cannot simply be stitched across
independent slabs; seams, complete coverage and clinical metrics remain pending.
The new path has not been benchmarked on native full CT/Mac M1/Safari. Existing
trained partial-reference Mac results remain separate. R1 and large-volume
whole-pipeline acceptance remain PARTIAL; do not raise guards or invent Dice.

Four modes and specialist/optional-LLM Evidence separation remain. No model,
checkpoint, worker policy, clinical patient release, cloud egress or .env.local
change. Full patient/privacy/auth/remote controls remain unreleased.
