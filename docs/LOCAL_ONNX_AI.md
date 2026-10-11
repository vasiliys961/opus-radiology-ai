# Opus Radiology AI v1.9 — REAL offline ONNX inference on Mac

This version introduces a **real, offline ONNX Runtime segmentation runner**.
It does **not** bundle a trained medical checkpoint. Until a model and its
documented preprocessing profile have been installed, no AI segmentation is
available. A synthetic identity model is used in CI solely to verify actual
ONNX execution, NIfTI geometry and result packaging; it **does not** detect
disease.

## Offline vs cloud — where data are processed

| Task | Engine | Data destination |
| --- | --- | --- |
| DICOM browsing, MPR, 3D, quantitative mask overlay | Cornerstone in browser | Mac |
| All-series study technical metadata audit | JavaScript in browser | Mac |
| 2D slice-wise segmentation using separately installed model | Python + ONNX Runtime **CPU** | Mac |
| Structural vision and textual synthesis with OpenRouter | Remote multimodal LLM | Third-party cloud |
| Real patient DICOM to an external LLM | **DISABLED** | Nowhere |

The existing 3D volume handoff already checks provenance: exported input
NIfTI, request metadata and source UID-derived hashes stay local. The new
runner is an offline executable **not** a cloud API endpoint; it reads only
local files, imports no network library and makes no HTTP requests.

## Mac M1/8GB — first setup

In the **real** GitHub clone and terminal Cursor:

    cd "$HOME/Desktop/opus-radiology-ai-github"
    python3 -m venv .venv-local-ai
    source .venv-local-ai/bin/activate
    python3 -m pip install --upgrade pip
    python3 -m pip install numpy onnxruntime

Use a native arm64 Python installation. The default implementation selects
**CPUExecutionProvider**, with two CPU threads (never assumes GPU, ANE or
Metal/CoreML will work). Actual speed depends on the model and study.
An ONNX checkpoint is **NOT** automatically downloaded or installed by these
commands. The model weights must come from a verified source, with declared
license, training dataset, anatomy/modality, input preprocessing and output.
Avoid heavyweight 3D models on an 8 GB Mac until profiled.

ONNX Runtime instructions: https://onnxruntime.ai/docs/get-started/with-python

## Model profile — required and exact

Store a local ONNX file and its JSON description, for example:

    ~/Models/Opus/model.onnx
    ~/Models/Opus/model.profile.json

The profile must be written **for the specific real checkpoint**. This is
an illustrative shape of the file, NOT a usable validated medical model:

    {
      "schema": "opus-local-onnx-profile/v1",
      "model": {
        "id": "REPLACE_WITH_ACTUAL_LICENSED_MODEL",
        "version": "REPLACE_WITH_ACTUAL_VERSION",
        "modality": "CT",
        "task": "organ-segmentation",
        "sha256": "REPLACE_WITH_REAL_64_CHARACTER_SHA256",
        "label": "Organ tissue — research only"
      },
      "preprocessing": {
        "method": "fixed-clip-zero-one",
        "clipMin": -1000,
        "clipMax": 400
      },
      "output": {
        "format": "NCHW-single-channel-binary",
        "activation": "sigmoid",
        "threshold": 0.5
      },
      "limitations": [
        "REPLACE WITH SPECIFIC DATASET, PERFORMANCE, AND DOMAIN RESTRICTIONS"
      ]
    }

Get the SHA-256 of **the downloaded ONNX checkpoint itself**:

    shasum -a 256 "$HOME/Models/Opus/model.onnx"

Insert that hash into the model profile.

### STRICT checkpoint input/output contract

- A verified 2D grayscale ONNX model with **one** input tensor,
  float32 **[1, 1, H, W]**, and **one** output float32 tensor
  **[1, 1, H, W]**; H/W must equal each source slice exactly.
  Dynamic axes may work only if the model supports them.
- Whole exported series is processed **one Z slice at a time**.
- The model profile must specify exactly the clipping and normalization
  actually used during training. No automatic guessing or resizing.
  If a pretrained model expects different preprocessing, it is **NOT
  compatible yet** and the adapter must be expanded and revalidated.
- The output is sigmoid logits (choose \`"activation": "sigmoid"\`)
  or already normalized probabilities in [0,1] (choose \`"identity"\`).
  Threshold is explicit, 0 < threshold < 1.
- A single foreground label 1, background 0. Models with multiclass
  outputs, RGB, 3D tensors, patch windows, spacing-dependent resampling,
  absent training preprocessing information or unverified weights are
  **NOT compatible**; the runner refuses them.
- \`"modality"\` must be CT or MR and must match the selected series.
  CT intensities should already be real rescaled HU; do not declare HU
  clipping for MR. MR intensities are sequence-dependent and require a
  model-specific, validated profile.
- A geometrically correct mask is still not a diagnosis, pathology flag,
  or validation of generalization to new scanners and protocols.

## Performing a REAL local inference (when a compatible model exists)

1. Run the app on **localhost** and load an actual DICOM study. Local
   private studies are not sent to OpenRouter.
2. Select a technically MPR-eligible series, then open **MPR → Сегментация
   → Пакет полного объёма для AI Engine**.
3. Click **«Подготовить пакет серии»** and download **both** the NIfTI and
   request JSON files. In the new **«Настоящий локальный AI на Mac»**
   panel, copy the exact terminal command for the current request ID.
4. Substitute/verify the actual \`~/Models/Opus/model.onnx\` and matching
   profile and run the command in Cursor. Example:

       python3 scripts/run-local-onnx.py \
         --input "$HOME/Downloads/opus-<REQUEST_UUID>_0000.nii" \
         --request "$HOME/Downloads/opus-<REQUEST_UUID>.request.json" \
         --model "$HOME/Models/Opus/model.onnx" \
         --profile "$HOME/Models/Opus/model.profile.json" \
         --mask "$HOME/Downloads/opus-<REQUEST_UUID>.mask.nii" \
         --result "$HOME/Downloads/opus-<REQUEST_UUID>.result.json"

5. The runner verifies exact SHA of the full input and ONNX model,
   declared model modality, source geometry and mask shape. The local CPU
   runs inference one slice at a time and writes **uint8 NIfTI label mask**
   plus a separate integrity-bound **\`opus-segmentation-result/v1\`**.
6. Back in the same MPR session, select **«Импортировать результат модели»**
   and choose both newly produced \`.mask.nii\` and \`.result.json\`.
   The existing UI rechecks request ID, source hash, image hash, mask hash,
   model modality, label dictionary and physical grid **before overlay**.
7. Review mask boundaries on axial/coronal/sagittal planes. A segmentation
   does not prove the presence or absence of a disease.

Do not overwrite old NIfTI or JSON outputs: the runner intentionally refuses
existing result paths to avoid mixing patient or study results. A changed input
or model file is rejected before inference. The model profile is supplied
locally and **not uploaded**. Output files may still contain patient-derived
anatomical geometry and must be handled as sensitive.

### Limitations and future clinical model integration

The runner has no currently bundled medical checkpoint. It does not infer
pathology across whole CT/MR, assess lesions outside the targeted label,
validate clinical sensitivity, distinguish incidental findings or generate a
clinical diagnosis. We must choose a specific licensed model and confirm
reference dataset, preprocessing, slice orientations, scanner/protocol domain
and accepted performance before calling it ready for medical use.

Immediate next steps: add specific CT chest/lung and abdominal organ model
adapters with **reproducible weights**, benchmark M1 RAM/time, then MRI brain
with verified preprocessing; build physician review and uncertainty logic.
OpenRouter remains **optional** for later cloud analysis only after
separate, explicit privacy/legal authorization and de-identification controls.
