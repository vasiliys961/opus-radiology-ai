# TotalSegmentator real lung-lobe DICOM/MPR overlay (experimental)

The full public LCTSC manual workflow now optionally verifies **real model
output in the actual browser** before cleanup. After downloading 103 CC BY 3.0
CT DICOM slices and running CPU TotalSegmentator, the same workflow extracts
an exact native 32-slice mask (original source frames 35–66). Playwright
then opens the actual Next.js + Cornerstone browser interface, imports exactly
those 32 unmodified source DICOMs plus the SHA-bound mask, and requires visible
nonempty overlays in axial, coronal, and sagittal MPR canvases.

No screenshots, DICOMs, masks or weights are published as GitHub artifacts.
The ephemeral test runner deletes these files in the final cleanup step.
The PR's automatic CI only tests source contracts and the regular build;
**real trained model plus browser verification must be manually dispatched**.

This tests geometric overlay, NOT anatomical correctness. Full-chest coverage,
independently annotated Dice, M1/Safari peak memory, and patient processing
remain unverified or disallowed.
