# Single-click CT chest: original pulmonary embolism model (CTPA only)

This uses the previously actually executed original Mazurowski/y zluka
PulmonaryEmbolismSegmentation nnU-Net model, not a newly trained candidate.
Task coverage is **distinct**: MONAI RetinaNet lung nodules; TotalSegmentator
task315 pleural/pericardial effusion; Mazurowski nnU-Net PE on **explicitly
physician-confirmed contrast CT pulmonary angiography**. No second lung-nodule
detector or redundant PE detection.

Open actual public/rights-cleared original CHEST DICOM. In the one-click study
analysis advanced settings confirm the current selected CT **is CTPA**, provide
the private Linux PE worker token and click the SAME main Analyze button.
The same exact native-HU NIfTI is used sequentially by available detectors.
Missing PE worker or nonconfirmed protocol gives "not assessed", not "no PE".
The worker checks original SHA, pinned release, exact vendor code revision,
real installed weight bytes, source 3D geometry and output axis layout,
then gives source-native PE model candidates and provisional review.

Original publisher release:
- Model: \`yzluka/PulmonaryEmbolismSegmentation\`, published HF revision \`7ce235f\`.
- Vendor code git revision: \`b4c50008bbbf825282ccf10767f819276e320fb9\`.
- Weight file: \`pytorch_model.bin\` with locally verified observed SHA-256.
- License: CC BY-NC 4.0 research only. No patient/commercial deployment.
- Prior single original FUMPE expert comparison **Dice 0.038119** (insufficient,
  so no negative PE reassurance and every candidate must be inspected).

The host is Linux >=12GiB RAM with original dependencies from the existing
\`.github/workflows/real-fumpe-pulmonary-embolism.yml\` installed. Use a private
OS-enforced network-isolated runtime, pinned revision, weights and 8GB free disk:

\`\`\`sh
cd services/imaging-ai
python pe_ctpa_direct_worker.py \
  --model-dir /private/official-published-PE-model \
  --vendor-code /private/official-vendor-PE-code \
  --weights-sha <verified-64-char-sha256> \
  --origin http://127.0.0.1:3000
\`\`\`

Use session token displayed by worker. No tokens or images in git. The
initial browser CTPA declaration is operator authorization, not a derived
DICOM phase verification. The private host MUST prevent egress while
vendor code executes. Model's anatomical localization uses original NIfTI
IJK/RAS, not proven DICOM SOP identity. Clinical validation postponed, not
replaced by Gemini/Opus opinion. They remain separately privacy-permissioned.
