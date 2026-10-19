# AI-CAC — actual published-model 103/103 TCIA LCTSC inference (research only)

**Source- and weights-bound technical result — not clinical CAC accuracy.**

- Successful [GitHub Actions run #39220436954](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39220436954); workflow "Genuine AI-CAC full 103-slice original TCIA CT inference".
- Original published model: Raffi-Hagopian/AI-CAC v1.0.0, original author SwinUNETR 2D/512.
- Weight SHA256 verified at execution:
  \`cfded8253e64b81b963a314cb5adc90d30a1f21574638366b80c783676c1733d\`.
- Original CT: TCIA LCTSC, CC BY 3.0, **all 103 original 512x512 DICOM frames**, no synthetic/duplicated/cropped model input.
- Original source DICOM SHA256 chain:
  \`bb4b90496cf2d83dac83e729ef271091962d532a18db201c6e2d99d42dcb5f61\`.
- Publisher's trained model ran on all **103/103** original HU slices, native source grid; actual model output finite.
- Total inferred positive source voxels: **74**.
- Native-grid connected-component candidates (>=2 voxels): **9**. Note: this is *not* nine verified coronary lesions.
- Largest candidate: **26 voxels**, native array row 246–252, column 265–272, z slices 56–57 (indices 0-based in ascending native z).
- Output model logit range: **-22.52658 to 1.45994**.
- Measured inference plus model setup: **569.203 seconds** on separate GitHub Ubuntu CPU worker.
- Recorded maximum process RSS: **1,954,600 KiB** (approximately 1.864 GiB). This is a Linux process, not total Mac RAM.
- Official GitHub numeric artifact: \`ai-cac-original-full-ct-real-numeric\`, SHA256 of artifact archive
  \`40bf9f5f58a7e9b47a00c880284add1d65073339742fff6d44c55dbcda889096\`.
- No source DICOM, images, checkpoint, patient identifiers, segmentation mask or screenshots are committed.

## Non-negotiable clinical interpretation

1. **LCTSC is not independently confirmed as a compatible nongated, noncontrast coronary calcium CT acquisition.** Genuine inference on authentic pixels does **not** validate model performance for the target pathology.
2. Expert coronary calcium mask: **not available**. Dice, sensitivity, specificity, lesion-level FROC and positive predictive value: **NOT MEASURED**.
3. Agatston score: **NOT REPORTED**. The publisher's nongated 3D approximation must not be treated as a calibrated gated Agatston score.
4. The nine components are **model-generated candidates, not diagnoses**. The 74 voxels may reflect out-of-domain signal or artifacts.
5. Training overlap, independent held-out case selection, source-protocol appropriateness, commercial model licensing, safe Mac M1/8GB runtime and clinical authorisation: **NOT ESTABLISHED**.
6. No patient-mode or cloud-LLM gate has been opened. This experiment uses only licensed public research data on a separate ephemeral Linux CPU runner.

**Next clinical gate:** original Stanford COCA nongated images and separately
released 203-case expert calcium masks, with lawful access and verified
scan-to-label exact spatial registration; independent holdout must be checked.
See [original AI-CAC evidence contract](AI_CAC_ORIGINAL_NON_GATED_RESEARCH.md)
and [Stanford COCA](https://aimi.stanford.edu/datasets/coca-coronary-calcium-chest-ct).
