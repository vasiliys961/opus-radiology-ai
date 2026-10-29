# One-click CT chest: original Raidionics mediastinal lymph-node segmentation

This is NOT a new candidate model. The original Raidionics CT_LymphNodes
ONNX v13 was already executed on the publisher's real mediastinal CT in
[research actions](https://github.com/vasiliys961/opus-radiology-ai/actions/runs/39311359233).
The model on a vendor test scan is not a validated clinical detector.

**Important dependency:** original publisher workflow REQUIRES a lung-mask
NIfTI matching the same original CT. The new private worker generates this
mask automatically by running the already installed, genuine original
Lungmask R231 with SHA-pinned weights. Lungmask is an ANATOMICAL prerequisite
and **does not count as a second pathology detector**. The downloaded original
105,186,900 byte Raidionics archive has SHA-256
\`922c0e99cb637a872d18b83300a648eb0d782b1ef874c5d33a551285e52ccb08\`.
R231 original pretrained weights SHA
\`d5d2fc3df432115933491f115b283e94d1f5c841c0e82f6e7bd2d65d3ccde69f\`.

In the DICOM Viewer, select a COMPLETE verified original CHEST CT and in the
one-click advanced settings confirm that it is a contrast-enhanced chest CT
suitable for mediastinal nodes. The **same main Analyze button** sequentially
executes available original MONAI lung nodules, TotalSegmentator fluid labels,
CTPA PE only when explicitly confirmed, and Raidionics nodes only when
contrast-CT confirmed. The same DICOM-to-NIfTI HU conversion is reused.

Worker requirements: isolated Linux CPU (>=10GiB free RAM), original pinned
\`raidionicsseg==1.5.2\`, \`lungmask==0.2.20\`, R231 inference dependencies,
both downloaded **original published** model files, sufficient disk and
OS-level no-egress policy. From \`services/imaging-ai\`:

\`\`\`sh
python raidionics_nodes_direct_worker.py \
  --model-archive /private/models/Raidionics-CT_LymphNodes-v13.zip \
  --lungmask-weights /private/models/unet_r231-d5d2fc3d.pth \
  --origin http://127.0.0.1:3000
\`\`\`

Copy the temporary session token into the advanced settings. No weights,
DICOM images or tokens go into GitHub. The worker accepts only the native
HU source, authenticates localhost, checks SHA/physical grid, runs R231 on
the exact native CT, creates a gzip NIfTI of same-source lungs and launches
the pinned RaidionicsSeg publisher config/ONNX. The browser displays native
voxel/RAS candidates; approximate DICOM slice navigation is expressly
not a verified SOP mapping.

Never interpret an ONNX lymph-node segmentation as a malignancy classifier,
a diagnosis of lymphadenopathy, an absent mediastinal mass or a clinically
negative chest CT. Original CT must be axis-aligned for the safe R231 path;
if oblique, report NOT ASSESSED rather than silently resample.

Clinical accuracy remains unvalidated. Independent Gemini/Opus assessment
is a separately authorized source-frame review, not a substitute for
clinical validation or source-geometry binding.
