# Real MONAI 0.6.9 nodule inference on one public LUNA16 CT — opt-in GPU

This is an executable genuine model task, **not** an inference claim yet.
It uses the pretrained MONAI 0.6.9 83.7 MB published checkpoint with its
already verified SHA-256 b5e79231466adae93a6fe8e8594029e9add142914e223b879aa0343bb2402d01,
the official MONAI transforms and detection saver, and ONE full genuinely
annotated public LUNA16 CT (\`.mhd + .raw\`) from pinned dataset mirror
revision af8fdf04c27dcaa97ccfd755043d8096299d6a40.

## How to run it only when specifically authorized

1. Supply a dedicated and trusted Linux x64 NVIDIA CUDA GPU worker with >=15 GiB VRAM,
   Docker/NVIDIA Container Toolkit, restricted external network access, and a
   GitHub self-hosted runner labelled \`opus-approved-gpu\`.
   Never attach this label to the user's 8 GiB Mac.
2. After the PR is manually merged and reviewed, open GitHub Actions:
   \`MONAI real lung nodule inference on one public LUNA16 CT (external GPU ONLY)\`.
3. Select \`main\`, explicitly enter \`PUBLIC-LUNA16-GPU-OK\`; without a matching
   runner the job stays QUEUED and will **never fall back to a CPU worker**.
4. The GPU is checked before any large download. The worker chooses the smallest
   truly *positive* LUNA16 subset0 CT, confirms the original public expert
   annotations and paired MetaImage header/dimensions, records raw source hashes,
   downloads official MONAI bundle, independently verifies pretrained model SHA,
   and executes \`python -m monai.bundle run\` with original raw-CT preprocessing.
5. MONAI DetectionSaver writes its actual \`box\` / \`label_scores\` / \`label\`
   predictions. Our output validates finite 6D world-box coordinates and scores,
   binds the model/source hashes and logs the genuine candidate list; it removes
   datasets/checkpoints after completion. No medical images are uploaded.

The generated research-only JSON explicitly distinguishes raw model candidates
from expert reference annotations and contains *no* clinical diagnosis.
\`coordinateFrameVerifiedAgainstSource:false\` stays false until an independent
LPS/RAS/native-grid test. Therefore no automatic MPR overlay or lesion size claim
yet; native/world reconciliation follows after a genuine successful GPU run.

The published MONAI metadata says **"This is an example, not to be used for
diagnostic purposes."** Training and validation both used LUNA16. One positive
sample is a smoke test, never an independent sensitivity/FROC or clinical
validation; a test including negatives and an entirely held-out cohort is needed.

Security: official checkpoint is a PyTorch state dict with possible pickle
loading; only run on isolated disposable workers. Container images alone do not
guarantee network isolation; enforce egress restrictions at the infrastructure
level. No patient data, cloud API keys, or physician claims can be used.
The worker's outbound internet is needed ONLY for known public data/weights
downloads; not an approval for patient cloud egress.
