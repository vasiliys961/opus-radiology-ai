# New dedicated pathology: PI-CAI nnU-Net csPCa on prostate bpMRI

The [official Radboud/DIAGNijmegen algorithm](https://github.com/DIAGNijmegen/picai_nnunet_gc_algorithm) is a **true lesion-specific trained MRI detector** of clinically significant prostate cancer (csPCa), **not** MONAI prostate anatomy. The official algorithm consumes axial T2, ADC, high-b DWI MetaImage (`.mha`) and writes a T2-aligned csPCa detection map and a case-level raw score. Original 5-fold weights are **NOT in this Opus repo and were NOT obtained or executed by this PR**. A [Grand Challenge published algorithm](https://grand-challenge.org/algorithms/pi-cai-nnu-net-baseline/) exists, but whether a particular ready-to-run image may legally be obtained, retained and reused must be established independently. The GPL/Apache code licensing and hosted algorithm access do **not** constitute a grant of redistribution or clinical rights for unpublished model weights. No reference sample has been executed here.

## Implemented code

`python scripts/real-picai-cspca-offline.py` is an **isolated optional research executor** for an already locally provisioned, licensed official-vendor-compatible Docker image containing trained algorithm weights. It refuses to run without image's exact local SHA256 ID. It requires three distinct *embedded-pixel* `.mha` images from a **lawfully licensed, de-identified public** prostate bpMRI study; formal independent operator confirmation of T2/ADC/high-b identity, suitable patient population and spatial alignment; original physical source geometry and a qualified Linux GPU research server (>=24 GiB available RAM). It never downloads models, attempts patient cloud inference or copies patient images into GitHub.

Command (illustrative only; **no genuine model image digest or source dataset license is provided here**):

```bash
python scripts/real-picai-cspca-offline.py \
  --t2 /private/approved-public-case/transverse_t2.mha \
  --adc /private/approved-public-case/transverse_adc.mha \
  --hbv /private/approved-public-case/transverse_high_b.mha \
  --original-docker-image-id sha256:REPLACE_WITH_ACTUAL_64_HEX_DIGEST \
  --source-license 'CC BY 4.0' \
  --source-url 'https://zenodo.org/records/6624726' \
  --output /private/approved-public-case/opus_picai_numeric.json \
  --licensed-public-deidentified-bpmri-verified \
  --sequence-and-treatment-eligibility-confirmed
```

The placeholder must be replaced by **actual source-specific license and legitimate preinstalled Docker image ID**; the PI-CAI public training data are *not an independent holdout* for this model. Nothing in this code downloads the dataset or trains/retrieves weights. Vendor container internal mechanism is treated as untrusted even if source code is openly available; verify image provenance and inspect its installed weights/licence separately before provision.

Docker policy: no network; read-only filesystem; only three read-only source MRI mounts; isolated private temporary output; capability drop, no-new-privileges, pids/CPU/RAM/shm and execution time limits; no uploaded input or vendor logs. Vendor algorithm must produce exactly the original `.mha` T2-grid detection map and JSON case score. An invalid/missing/altered output or mismatched original T2 voxel/physical grid fails closed, **not a negative prostate finding**. No Mac M1 8GB execution.

## Actual new spatial functionality

- Verify original source T2, ADC and high-b scanner coordinate validity and scan field-of-view alignment (does not pretend to identify sequences from metadata).
- Bind the actual three original MRI file SHA256 hashes, vendor image ID, and the genuine algorithm-produced map SHA256.
- Check vendor raw case score equals output map maximum. Run bounded 3D connected-component analysis on the vendor map, keeping each candidate's T2-grid bounding box, source T2 index XYZ, RAS-world centroid, mm³ volume and uncalibrated peak/mean score.
- Prevent naming an uncalibrated heatmap or a lesion candidate as PI-RADS, verified cancer, probability of histologic disease or cancer exclusion.

## Limits and next clinical gate

1. **Now implemented:** isolated runnable adapter, source-geometry and output-map evidence, candidate localisation, numerical contracts, strict safety requirements.
2. **Source published:** PI-CAI lesion-specific nnU-Net inference code and Grand Challenge model; availability to this worker and rights of the actual trained checkpoint remain **unverified**.
3. **Still missing:** lawful mounted original model image with actual digest/weight provenance, positive public T2/ADC/high-b MRI inference on GPU, true expert/histology matched masks, independent lesion-level FROC and clinical sensitivity, review in source DICOM MPR.
4. **Not authorised:** patient data; any actual clinical/diagnostic use; automated PI-RADS or histopathology diagnosis; cloud LLM integration.

Research sources:
- Original baseline: https://github.com/DIAGNijmegen/picai_nnunet_gc_algorithm
- Challenge dataset: https://zenodo.org/records/6624726 (1500 scans; training cohort, not independent test for original model)
- Original challenge: https://pi-cai.grand-challenge.org/algorithms/

Technical test CI creates synthetic score volumes only. It cannot substitute for trained-model inference or clinical validation.