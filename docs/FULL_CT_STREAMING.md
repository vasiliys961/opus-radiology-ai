# Full supplied CT series: disk streaming and bounded MPR — 2026-10-12

Baseline main `b60badd` has manually merged PR #33 and green Web/Python checks.
This is a separate research-only v2 path, not a global increase of existing guards.

## Implemented engineering path

From 2D, the operator explicitly starts the full supplied CT series through the
loopback R231 worker. One owned native DICOM plane is decoded at a time, with
preScale disabled and exact slope/intercept applied once. Geometry is derived
from original DICOM positions/orientation/spacing and checked at every physical
frame corner to 0.05 mm. Unknown/mixed/oblique/nonuniform/multiframe geometry
fails before scalar decoding. Only axis-aligned CT up to 512x512x300 is supported.
All supplied SOP identities are salted/bound separately from the exact input SHA.

A scalar pass computes the complete NIfTI SHA; a second pass transmits acknowledged
128 KiB chunks. No complete native float32 volume/Blob/3D viewer is allocated by
this stream. The ordinary 2D viewer may retain its own current/cache images;
this is not a claim that the entire browser holds only one plane. Full MPR/3D
switches are disabled while the full job is running.

The worker advertises optional fullCt capabilities and accepts the strict existing
allowlist under opus-analysis-request/v2. It maps the exact float32 file, checks
HU per plane and attempts MADV_DONTNEED on supported systems. Pinned R231 arithmetic,
float32 weights, batch 1, preprocessing and complete 256x256 connected-component
postprocessing stay unchanged. This is one whole-series model execution, not
independently segmented slabs stitched together. Native uint8 output is restored
and written one plane at a time, including all signed-axis permutations; no
complete native uint8 output allocation is made. The compact label volume and
postprocessing workspaces remain whole and scale with the declared frame bound.

Admission separately budgets bounded native-plane work, mapped-page allowance
and full compact-volume workspaces. These estimates are PROVISIONAL. Safe thread
and inter-op limits, 384 MiB margin, 256 MiB system reserve, 2 GiB process ceiling,
RSS/system-pressure stops, authenticated Origin/Host/session and one-job limit
remain. If page-discard advice is unavailable/ineffective, guards can stop the
job; no Mac/Windows total-RAM guarantee is implied. Progress shows inference,
postprocessing and restoration, not an invented clinical confidence score.

## Result viewing, Evidence and lifecycle

A completed full job remains in the worker for bounded viewing; its model child
has exited. The full mask download endpoint rejects v2 jobs. Selecting a native
MPR slab requests at most 32 frames / 8,388,608 voxels. The response carries a
proof binding full request ID, salted source identity, full input/mask SHA,
range, shifted LPS grid and cropped mask SHA. A forged range/grid/source/hash is
refused before replacing the overlay. MPR still uses its unchanged 48 MiB guard;
manual scalar export and generic mask import still retain their old voxel caps.

The crop is explicitly a derivative of the full result, not a new model run.
Its display controls work normally; the full source/model-bound quantitative
Evidence is exported separately as opus-full-ct-evidence/v1. It includes full
label counts/volumes, coverage limitations, sanitized model/request/metrics and
no token, endpoint, image bytes, filename or raw SOP identifiers. This remains
unsigned research Evidence, not clinician sign-off or a clinically normal study.
Existing specialist/LLM reconciliation contracts remain unchanged.

Deletion clears derived overlays; failure to confirm deletion remains visible
and can be retried. Source replacement/unmount aborts processing and deletes the
owned job. Page-hide deletion is best effort; worker TTL still guarantees cleanup
30 minutes after job creation. One crop file is retained, not an accumulating
cache of slabs. Failed/incomplete jobs never expose a valid mask/result.

## Verification (no new trained or paid inference)

- 266 Web unit tests: old guards, whole-series header/rescale/SHA, backpressure,
  early return/cancel and plane release, source/grid/model/range/hash rejection,
  retained result vs explicit delete and secret-free export.
- 58 Python tests pass; 3 optional Torch tests skip because the medical stack
  is not installed in this execution environment. V1 guards and admission stay
  covered. Full HTTP integration transfers a synthetic 512x512x33 job ABOVE the
  old voxel/input boundary through the real worker API with a fake model child,
  checks bounded mask proof and deletion. Storage equals full-array restoration
  for all eight signed-axis combinations. Full reference preparation uses a
  pinned synthetic ZIP test, not a new public download.
- Typecheck, clean production build and Chromium: actual mathematical DICOM
  decoding with rescale intercept -1000, independent check of every transmitted
  voxel, exact SHA, full retained job WITHOUT full-mask download, Evidence export,
  forged-crop rejection, bound native crop in three MPR planes and overlay/job
  deletion. Worker predictions are mocked. Existing viewer/Evidence/privacy/OCR
  and small-job contracts pass.

No trained checkpoint exists here, so newly trained full-series inference,
Mac M1 system/browser memory/swap/response, Safari and clinical Dice/HD95 are
NOT verified. R1 acceptance remains PARTIAL. Four execution modes and optional
Gemini/Claude/GPT through Evidence remain; private CPU/GPU and patient/cloud
production controls are not enabled. .env.local is untouched.

## Mac acceptance after manual merge (existing environment/weights)

Run Next dev from web; in a second terminal at the repository root:

```bash
bash scripts/start-local-lungmask.sh --profile safe --origin http://localhost:3000
```

Use the actual Next origin if the port differs. For the known TCIA reference,
optional preparation of all 103 pinned unchanged source frames is now available:

```bash
.venv-lungmask/bin/python scripts/download-r231-browser-reference.py \
  --download-public-reference --full-series \
  --output "$HOME/Downloads/opus-full-ct-reference-$(date +%Y%m%d-%H%M%S)"
```

This explicit command downloads public data, not weights or a model run. Existing
SSL_CERT_FILE/certifi setup may be needed on the user's Python installation;
no .env.local edit is needed. Default preparation remains 32 slices. The full
manifest records allSourceFrames=true, but fullChest=false because anatomical
completeness is not automatically certified.

Load the resulting dicom folder, stay in 2D, expand the full-CT panel, enter the
current ephemeral worker token and confirm the research scope. Start the full
series once. Save Evidence JSON; check v2, frameCount=103, dimensions=512x512x103,
inputSha256 against reference.json's NIfTI candidates, correct R231/weights and
full-ct-streamed-r231/v2 metrics with nonzero measured inference/RSS. Then select
bounded ranges and view the full job's mask without another inference. Check
original physical slices, both whole-result lung labels and deletion. A guarded
resource/input/model failure is FAIL/unverified, never a negative clinical result.
Record system/browser RAM and swap separately before claiming M1 acceptance.


## Reproducible complete-reference browser acceptance

After environment/checkpoint installation, one opt-in command prepares the pinned
public reference and executes **all 103 unchanged source frames**:

```bash
bash scripts/test-r231-browser.sh --download-public-reference --full-series
```

Default invocation still verifies the existing 32-frame slab. The new path uses
one full v2 inference, then sequential native ranges 0–31, 32–63, 64–95 and 96–102.
Every crop's source/full-mask/range/physical-header/SHA proof is independently
checked. Crop voxels are hashed in native order to reconstruct the complete mask
SHA and label counts **without a full native mask allocation**. All ranges render
three MPR overlays; peripheral empty planes are permitted, while at least one
range must have visible labels in all three planes. Evidence export, zero full
mask GETs and DELETE→404 are checked. Inference is never mocked in this command.

The report is `metrics.json` outside the repository, schema
`opus-r231-full-browser-verification/v1`. PASS requires actual trained inference,
all 103 frames, exact uploaded scalar SHA, full/crop binding, both whole-series
labels nonzero, complete mask SHA/counts, MPR and confirmed deletion. Any failure
writes sanitized diagnostics and exits nonzero; no screenshots/pixels/tokens are
saved. It does not certify complete anatomy, clinical accuracy or a normal study.

A separate 1 Hz observer records system minimum available RAM/swap and peak summed
RSS of the controller's process tree. Summed RSS double-counts shared pages; system
figures include unrelated applications; short peaks and responsiveness remain
unmeasured. These figures supplement model RSS, not an 8 GB acceptance guarantee.
The full panel accepts another loopback port under the existing strict session
validation; the harness uses ephemeral ports without changing `.env.local`.

Manual GitHub Actions `Real R231 public reference` offers `coverage=full`; the
ordinary CI remains synthetic. Chromium on Linux or Mac does not verify Safari.
Mac M1/Safari/repeated responsiveness and clinical evaluation remain separate.


### Actual complete-reference Linux result

[`verification/r231-full-browser-linux.json`](verification/r231-full-browser-linux.json)
records one successful trained full-series run from the feature working tree on
baseline main `bf967e5`; exact runtime source file hashes are attached. All
512x512x103 source frames, 825 chunks / 108,003,680 input bytes, both lung labels,
complete mask SHA, four bound native MPR ranges, no full-mask GET and DELETE/404
pass. Safe CPU inference takes 116.761 s; whole harness takes 144.577 s. Model
peak RSS is 588.92 MiB. Summed process-tree RSS peaks at 1,834.25 MiB (shared pages
are counted repeatedly); observed system swap starts/peaks/ends at zero. These
are Linux measurements, not a demonstrated Mac improvement or responsiveness
acceptance. Final seven peripheral slices have no lung labels; this is not a
normal/negative clinical finding. 271 Web tests, 64 Python tests (optional Torch
installed), typecheck/build and synthetic Chromium regression pass.

The whole-mask SHA uses the exact acknowledged input header with only datatype
changed to uint8. Crop headers re-encode shifted float32 geometry, so their bytes
must not be reused to reconstruct the full header: signed-zero representations
can differ despite an equal physical grid. Crop replies are relayed unchanged by
the test interceptor, avoiding DevTools response-body eviction; buffers remain
bounded. No mask/model arithmetic or resource threshold was changed.
