# Abdominal CT: aortic dilatation triage based on anatomical pretrained segmentation

**Research-only. New anatomical/vascular task: axial aortic-calibre candidate**, not an automatically diagnosed abdominal aortic aneurysm.

## What actually runs

The new standalone executable scripts/real-aortic-axial-caliber-ct.py consumes a **real external aorta.nii.gz binary mask** from the pretrained TotalSegmentator 2.18.0 "total" CT task on an exact native CT NIfTI. TotalSegmentator source: https://github.com/wasserth/TotalSegmentator/tree/v2.18.0

Numerical computation: read source-aligned 3D binary aorta mask, check millimetre NIfTI units, non-sheared near-axial 3D affine, compare complete image and mask shape/affine, find largest aortic component per axial slice, calculate physical area, area-equivalent diameter, largest boundary (Feret) diameter and 3D voxel/RAS coordinates. Output numeric-only SHA-256-bound JSON; no DICOM, image, report, mask or identifiers uploaded. Source evidence SHA and mask bytes SHA both recorded. Pixel provenance and model weights **not proven by hashing the model checkpoint**.

Code example on **licensed, de-identified public CT only**, on a separate research Linux CPU/GPU worker:

    # Run genuine TotalSegmentator 2.18.0 separately, using PREINSTALLED
    # task=total compatible weights in an already network-isolated environment.
    TotalSegmentator -i /data/public_ct.nii.gz -o /scratch/total_seg \
      -ta total --roi_subset aorta --fast --device cpu
    python scripts/real-aortic-axial-caliber-ct.py \
      --ct /data/public_ct.nii.gz \
      --aorta-mask /scratch/total_seg/aorta.nii.gz \
      --output /scratch/aorta_numbers.json \
      --source-license "CC BY 3.0" \
      --source-url "https://www.cancerimagingarchive.net/collection/lctsc/" \
      --public-research-consent

The displayed license/source above is only an **example** for the TCIA LCTSC collection, not proof that this aortic algorithm was executed on LCTSC. Supply the **actual study's verified license/source**. Do not download source data or model weights from inside a network-isolated worker. Upstream may automatically download missing weights unless they are pre-installed. Validate the vendor license of pretrained weights separately.

## Clinical measurement and safety boundaries

- Diameter flag: maximum native **axial voxel-centre Feret diameter >=30.0 mm** on any included slice. Output contains individual source slice indices, world RAS centroids and voxel bounding boxes for clinician review.
- This **is not** outer-to-outer aortic diameter, not orthogonal MPR along centreline, not automatically localized to infrarenal aorta, not sensitive to full aneurysm morphology, and not a AAA clinical diagnostic criterion by itself.
- Oblique or sheared volumes, zero/short aorta segmentation, physical-grid mismatch, nonbinary masks and unsupported source data fail closed. Absence of a flag **does not** imply exclusion of pathology.
- The output is intentionally flagged candidate/research-only with no assertion of clinical sensitivity, specificity, scanner/phase-generalization, expert Dice or model accuracy.
- Mac M1 8 GiB, browser integration, inference resource usage and real positive expert-matched cases are **not validated**. No patient mode, no cloud processing, no remote model API.

Anatomical segmentation is not a trained pathological aneurysm classifier. A candidate produced by a pretrained aortic structure model followed by geometry cannot be promoted to lesion detection without matched expert cases.

Clinical measurement requirements: ACC/AHA 2022 aortic imaging guidelines recommend dimensions at reproducible landmarks **perpendicular to the flow axis**, with multiplanar reconstruction when available, to avoid axial/oblique measurement error: https://pmc.ncbi.nlm.nih.gov/articles/PMC9876736/

## Evidence status

1. **Implemented:** bounded, source-grid-based postprocessor; numeric evidence, safety guards and synthetic numerical tests.
2. **Already available upstream:** genuine pretrained TotalSegmentator CT anatomy model and method to obtain its aorta mask.
3. **Not performed for this new workstream:** original trained aorta mask on a public positive AAA CT; vendor checkpoint SHA confirmation; physician-defined infrarenal landmarks; independent expert outer-wall 3D calipers; lesion accuracy / sensitivity.
4. **Next gate:** source-licensed positive AAA CT + actually executed vendor model with recorded SHA-256, source-mask physical equivalence and expert caliper comparison. Replace axial flag with orthogonal centreline diameter for serious physician-facing workflow.

No synthetic image or test is a substitute for real public positive CT inference.
