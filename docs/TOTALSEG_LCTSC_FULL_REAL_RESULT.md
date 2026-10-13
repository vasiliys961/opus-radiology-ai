# TotalSegmentator on full available public TCIA LCTSC series — REAL execution

[GitHub Actions run 38349118315](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/38349118315)
completed trained **TotalSegmentator 2.18.0** CPU inference on
all **103 genuine DICOM source slices**, assembled into **512×512×103**
HU NIfTI with source SHA-256 binding. Output mask passed native-grid and
allowed-label checks. Inference-wrapper elapsed time was **33.49 sec**.

Five nonzero lobe IDs were present: 10=309977, 11=337404, 12=308177,
13=50758, 14=178933. This corrects the missing-label phenomenon seen on
the earlier very small upstream CT reference, but **presence of five
labels does not establish anatomical completeness or accuracy**.

Hashes, source dimensions and exact observed JSON are recorded in
\`docs/verification/totalseg-lctsc-full-public-ct.json\`. The ephemeral
runner deleted both input and predicted mask after execution. This is
an engineering result; the **Dice score is not known**.

For a later licensed independently annotated matching native-grid
reference, \`services/imaging-ai/totalsegmentator_dice.py\` provides bounded
streaming per-lobe Dice with strict source SHA, predicted mask SHA, reference
mask SHA, reference-independence attestation and geometry checks. It refuses
to score a missing/mismatched/relabelled reference. It never invents
ground truth or calls two identical masks an independent benchmark.

Example (only with valid local public research masks, not patient data):

    python services/imaging-ai/totalsegmentator_dice.py \
      --prediction /secure/predicted.nii \
      --prediction-report /secure/opus-inference-report.json \
      --reference /secure/independently-drawn-lobes.nii \
      --reference-manifest /secure/reference-manifest.json

The independent reference manifest needs the schema
\`opus-totalseg-independent-reference/v1\`, sourceSha256, maskSha256,
independentAnnotationAttested=true, licensedForResearch=true, and
annotationMethod set to expert_manual or curated_reference.

No benchmark is executed with the current TCIA ZIP because this workflow
does not contain independently annotated five-lobe masks. Predicted labels
are not medical findings. Patient/cloud processing remains blocked.
