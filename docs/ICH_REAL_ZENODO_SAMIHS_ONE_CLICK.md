# ONE-BUTTON genuine pretrained SAMIHS → Zenodo CT → expert mask (CPU)

**REAL workflow:** https://github.com/vasiliys961/opus-radiology-ai/actions/workflows/ich-samihs-real-zenodo-cpu.yml

**Not an existing successful real result.** The earlier green "ICH bounded CPU SAMIHS pilot safety and native-grid contracts" workflow tests only generated numerical fixtures, not the model. This workflow is distinct.

## Run
1. Open the REAL workflow link. Select **Run workflow → main**.
2. Confirm noncommercial public-data use rights for the Zenodo dataset *only if authorized*.
3. Confirm consent to execute a fixed-revision upstream PyTorch checkpoint in a disposable GitHub CPU runner. Pinned digest is NOT an independent checkpoint/code audit.
4. Choose 16 native consecutive CT slices for initial feasibility (32 only when resource limits permit), and select **Run workflow**.
5. On **actual success**, download the artifact named **genuine-samihs-public-ct-expert-comparison**. It contains JSON numeric measurements, source/checkpoint hashes, and explicit slice-coverage limitations; NO CT pixels, image masks or weights.

## Authentic inputs and verified provenance

- Published research SAH noncontrast head CT and matching manually segmented NIfTI expert mask: https://zenodo.org/records/8228847. Fixed source RAR archive MD5 a67bf358ebb326f156071864c318ab42 (~648.5 MB). The authors already anonymized, resampled, skull-stripped and normalized the source. This is NOT guaranteed to retain original CT Hounsfield Units or raw DICOM geometry. Source and original expert license/usage rights must be verified independently; public download alone is not blanket permission.
- Actual SAMIHS pretrained model from https://huggingface.co/MooreMuaMu/samihs-ich-segmentation at exact revision 29aaa1287ca35b19e40495bd4966fa2923871cb9; pretrained official checkpoint SHA-256 b4c5ff729b906605555f83359120341a72035d1b6a784a9fef7dd61ee09a639e. The wrapper's SHA-256 is calculated from that fixed revision. Checkpoint integrity is NOT a code-execution safety audit.

## True research inference path

GitHub-hosted standard Ubuntu CPU VM (no GPU or paid inference API). Privately download and validate Zenodo archive MD5, bounded 7 GiB extraction, inspect original NIfTI geometry and pair original source/expert using shared subject identifier and matching physical native grid; refuse unreliable correspondence. Find positive original expert K-plane, select 16/32 neighboring consecutive original source K-planes, preserve original stored voxel values, shifted affine and source/expert SHA-256; derive only the corresponding binary expert-label slice subset.

Download official fixed-revision SAMIHS model and verify original checkpoint digest; explicitly authorized vendor PyTorch wrapper runs actual trained inference on these original source voxels, CPU, batch size 1, <=1200 seconds. Only after exact binary source-aligned output calculate true Dice, IoU, HD95 where meaningful, TP/FP/FN, volume and time.

Only a positive slice-selected portion of a single case is evaluated. NEVER report as full-case sensitivity, training holdout, calibrated confidence, lesion-level clinical sensitivity or diagnosis. Upstream skull stripping/intensity normalization may cause out-of-distribution behavior. Full study was NOT processed, DICOM SOP identity NOT bound. Clinical validation remains false.

GitHub Actions artifacts contain only generated JSON measurements/source SHA; no original CT image, expert image, prediction mask or model weights. A failed CPU model run means no pretrained inference result and no fabricated numbers. Run's green status with artifact is the only completion signal.

Old CUDA full-series first-case pipeline remains unchanged.
