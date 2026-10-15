# Research-only original ICH CT image review with genuine model proposals

The real public pretrained ICH run in [Action 38734338486](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38734338486)
has 14 subtype/any source-space proposals on 7 neighboring slices of ONE
licensed PHE-SICH-CT-IDS 512×512×25 noncontrast head CT. The original
full numeric research output is in
`web/public/examples/ianpan-ich-real-figshare-run-38734338486.json`,
bound to original NIfTI SHA256
`0543a46065314468fe7ab18b9187277ae1affc4e7c864d0fd8ae608afa554a95`.

This addition shows **actual original voxel values** beneath the
existing source-space model candidate boxes in the physician's ICH
research panel. It is not a synthetic picture of what the model might have
seen.

The source file is a separately authorized and already prepared original
uncompressed `.nii`. For this public example it is the precise
`public-original-head-ct-hu-like.nii` emitted by the original published
Figshare source workflow. The browser-local file is NEVER sent to Opus,
OpenRouter, Gemini, GitHub or an external model.

Before the image appears the browser must:

1. Parse exact bounded 3D little-endian NIfTI-1 original sform/millimetre
   geometry and reject inconsistent scales, unsupported pixel format or
   excessive memory.
2. **Stream SHA-256 of the ENTIRE original NIfTI** and require it to match
   the pretrained real report's exact 64-character source digest.
3. Independently map every research model native XYZ ROI corner through
   that ACTUALLY OPENED NIfTI's affine, from LPS to RAS, and match all
   six reported original physical world min/max bounds within 0.35mm.
   Same dimensions alone are not sufficient.
4. Read only ONE true unresampled source-native slice (float32 or int16)
   at a time: at most 512×512×4 bytes / 1MiB. Render neutral
   brain, subdural or bone HU-like display windows, and dashed ROI
   boxes ONLY on matching source slice indices. A mouse click can report
   an original source voxel's scalar value.
5. Refuse mismatched source identity/geometry; clear stale CT and slice
   data when the model report changes. A model region without a verified
   original voxel projection is NOT drawn.

**Caution:** This is a clinical-research *visual* tool, not a patient
diagnostic pipeline. The original images show HU-like stored values but
original source DICOM RescaleSlope/Intercept are not independently
available. The source NIfTI is not linked to patient DICOM SOP instances.
Published reference masks cover PERIHEMATOMAL EDEMA, not expert
hemorrhage segmentation. Dashed model bounding regions ARE NOT
hematoma masks, volume or proof of sensitivity. A radiologist must
review genuine source pixels and independently annotated hemorrhage
before declaring a true-positive lesion.

This module does not request that the project owner test, upload,
or configure anything during development. CI validates source hash,
native slice extraction, false world-affine rejection and no duplicate
'any hemorrhage' counting on **synthetic pixel fixtures only**.
No real model is rerun; the already observed genuine model JSON is reused.
