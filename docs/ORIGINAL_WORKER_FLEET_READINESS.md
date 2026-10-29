# Original detector fleet readiness: what is actually runnable

The DICOM viewer now has **one** read-only, automatically checked
"Настоящая готовность Linux-детекторов" panel. It reports separately
for TEN original model workstreams (not the number of clinical diagnoses).
Missing runtime, missing server authorization and unverified original model
are separate states. **No source image, patient information, original DICOM,
file name, source SHA, weights or tokens are sent to the health endpoint.**

The route is \`GET /api/local-model-readiness\`, deliberately available
only for same-origin browser requests in localhost Next **development**.
It cannot expose a remote public endpoint without authentication/review.
For every configured server token it contacts one **fixed** 127.0.0.1 port,
supplies its private original-worker bearer token and exact configured
local origin, and checks the existing version/weight/checkpoint-specific
capability parser. A positive \`ready\` is based on actual model weights and
the live local HTTP worker, never on a code module merely existing in GitHub.

| Server-side environment name | Fixed research worker | Capability |
|---|---|---|
| \`OPUS_NODULE_WORKER_TOKEN\` | 127.0.0.1:8768 | MONAI lung nodules |
| \`OPUS_EFFUSION_WORKER_TOKEN\` | 127.0.0.1:8774 | Task315 chest fluid |
| \`OPUS_PE_WORKER_TOKEN\` | 127.0.0.1:8776 | Original Mazurowski CTPA |
| \`OPUS_NODES_WORKER_TOKEN\` | 127.0.0.1:8777 | Original Raidionics nodes |
| \`OPUS_ABDOMEN_WORKER_TOKEN\` | 127.0.0.1:8775 | Original abdominal models |
| \`OPUS_ICH_WORKER_TOKEN\` | 127.0.0.1:8766 | ianpan hemorrhage |
| \`OPUS_WMH_WORKER_TOKEN\` | 127.0.0.1:8772 | WMH published model |
| \`OPUS_BRAIN_WORKER_TOKEN\` | 127.0.0.1:8778 | ISLES22 and BraTS separately |
| \`OPUS_XRV_WORKER_TOKEN\` | 127.0.0.1:8779 | NIH DenseNet121, six CXR heads |

For existing original workers the operator puts their **already existing
private tokens** in the Next server's ignored \`.env.local\` and confirms
that the worker is configured for the same local UI origin. No keys are
rendered into the browser. If \`OPUS_LOCAL_WORKER_ORIGIN\` is unset, the
default used internally is \`http://127.0.0.1:3000\`. This can be changed
only to another local loopback HTTP origin, not a public network address.

The original model worker itself remains responsible for secure trained
checkpoint loading. Merely setting any of these environment variables
cannot cause an absent model to be reported as ready. Nor does it
download new weights, allocate RAM, run a model inference, contact Gemini,
or authorize a patient study. **This is observational readiness only.**
Actual end-to-end public DICOM inference and independent clinical validation
remain separate milestones.

Only XRV currently has a one-command supervised systemd user-service
install. The other heavy workers still require original weight deployment
and actual supervised startup on an appropriate Linux server. The status
panel intentionally shows the truth rather than claiming to start them.

Operational note: clinician MacBook Air M1 (8GB RAM) remains the browser
host; most high-memory 3D CT/MRI workers require dedicated Linux resources.
Yandex Disk is optional archive storage and is not needed to inspect status.
