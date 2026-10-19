# New CT nephrolithiasis workstream — anatomical ROI + HU calculus **candidates**

## Exact clinical task and its limit

An optional research-only executor, \`scripts/real-renal-calculus-ncct-candidates.py\`, identifies spatially localized **high-attenuation connected components within the left and right kidney masks** on native, thin-section, **noncontrast** CT (NCCT). It calculates HU peak/mean, voxel-space 3D boxes, original image RAS centroids, estimated lesion volume (mm³), equivalent-sphere diameter and component count for physician review.

This is **not** a fully trained renal stone lesion classifier. The prerequisites are actual pretrained TotalSegmentator v2.18.0 CT *anatomical* kidney masks \`kidney_left.nii.gz\` and \`kidney_right.nii.gz\` produced separately on a legal public CT. Source: https://github.com/wasserth/TotalSegmentator/tree/v2.18.0. The presence of a binary mask does NOT prove its vendor provenance or genuine trained inference; checkpoint SHA and source run manifest must be independently recorded.

The 130 HU threshold is an **adjustable research candidate filter** (allowed 120–250 HU), not a diagnostic stone threshold established with sensitivity/specificity. It may detect intrarenal calcifications or vascular calcification, not stones only. Dense stones outside kidney masks (ureter, renal pelvis extension), small or low-density stones, focal artifacts, dense contrast, and missing mask may be missed. The code cannot distinguish adjacent renal vessel calcification. A noncontrast scan must be verified by image acquisition protocol rather than derived solely from pixel values. No stone exclusion from a negative candidate list.

## Run in separate optional research environment

Use **licensed, public, de-identified** noncontrast thin-section abdominal CT with original HU scale and authentic pretrained anatomy masks already pre-provisioned in a separate isolated CPU/GPU environment. Inference, weight provenance and model licence must be verified independently; neither a viewer nor a local Mac M1 8 GB automatically runs this script.

    python scripts/real-renal-calculus-ncct-candidates.py \
      --ct /research/licensed/ncct-native-HU.nii.gz \
      --kidney-left /research/licensed/seg/kidney_left.nii.gz \
      --kidney-right /research/licensed/seg/kidney_right.nii.gz \
      --output /research/licensed/renal-candidates-numeric.json \
      --source-license "CC BY 4.0" \
      --source-url "https://example.org/licensed-source-collection" \
      --licensed-deidentified-public-NCCT-confirmed

The URL is a placeholder; **never state the source has that license without independent verification.** Prior to execution, obtain a dataset with an explicitly permissive license and subject-level research permission.

Three NIfTI volumes must share exact voxel shape and physical millimetre affine (<=1µm tolerance), no symlinks or oversized sources. Full native resolution bounded to <= 512 × 512 × 500 voxels and <=3mm per-axis step. Missing anatomy, uncalibrated HU, unexpected label values and overlapping left/right masks fail closed. Input/output images remain on the isolated worker; result writes only numerical candidate geometry and three sha256 digests of source/masks, without name/UID/patient values, remote calls, screenshots or real studies in GitHub.

## Validation level

- **Code implemented:** controlled kidney-mask geometry, 6-connected 3D calcification components, quantitative volume/intensity and source coordinate evidence.
- **Source-published model exists:** TotalSegmentator kidney anatomy; this new code *does not* install, run or independently verify original trained weights.
- **Engineering tests:** synthetic HU and voxel geometry only.
- **Not measured in this workstream:** real positive stone NCCT, lesion-specific segmentation/checkpoint, expert case reference, sensitivity/specificity/FP per scan, official Dice, clinical performance, physician/real-patient acceptance.
- **No patient mode/cloud/LLM.** Never promote its "candidate" output into a confirmed renal stone diagnosis.

For further development, source real de-identified positive NCCT with independent radiologist confirmed kidney/ureter calculus coordinates and known noncontrast acquisition, run authentic TotalSegmentator and this candidate extractor, compare study-level and lesion-level false positives and misses. A true pathology pretrained detector is still the desired next milestone.
