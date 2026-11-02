# Automatic MONAI executor selection in the original DICOM viewer

The primary Analyze action reuses the existing original RetinaNet detector for
chest CT. It rechecks installed model identity and current readiness at launch,
prefers the configured local channel, then checks a configured private Linux
channel if the first is unavailable. Discovery sends only capability GETs;
exactly one selected executor receives the original source-bound HU upload.
An upload/inference error never launches a second model automatically.

The viewer shows ready/local/private, unavailable, running, failed, cancelled
and completed states. Source SHA, report geometry and original checkpoint checks
remain in the existing execution/parser path. Other compatible tools continue
when this detector is not assessed.

This is an integration of the existing research-only model, not a new checkpoint,
Mac-native MONAI support, patient-data authorization or clinical validation.
The authentic MONAI worker still requires Linux and at least 9 GiB free RAM;
it must not be forced onto an unsupported Mac M1/8GB by lowering its guards.

## Administrator configuration

No clinician enters worker addresses or passwords. The Next server reads:

| Setting | Purpose |
| --- | --- |
| `OPUS_MONAI_WORKER_TOKEN` | Existing local-channel bearer; legacy `OPUS_NODULE_WORKER_TOKEN` remains supported |
| `OPUS_MONAI_PRIVATE_TUNNEL_URL` | Explicit private SSH tunnel, e.g. `http://127.0.0.1:18768` |
| `OPUS_MONAI_PRIVATE_WORKER_TOKEN` | Bearer of that already installed private original worker |
| `OPUS_LOCAL_WORKER_ORIGIN` | Exact loopback origin authorized by workers, default `http://127.0.0.1:3000` |

Provision tokens separately through the administrator's secret configuration;
do not copy existing `.env.local`, expose tokens in the browser or commit them.
The worker's own launcher defaults to reading `OPUS_MONAI_NODULE_WORKER_TOKEN`:
configure the matching value on its host and in the appropriate Next setting.

For the private channel run the existing `monai_nodule_upload_worker.py` with
`--port 18768` and the same authorized `--origin`. Establish an SSH tunnel with
**equal local and remote ports**, for example:

```sh
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:18768:127.0.0.1:18768 research-worker
```

`research-worker` is an administrator-managed SSH host alias, not an included
server. Equal ports preserve the authentic worker's strict HTTP Host check.
No public worker listener, arbitrary remote URL, redirect, browser-supplied
destination or automatic server provisioning is enabled.

## Job continuity and cancellation

Upload returns a signed four-hour binding to the selected executor and exact
job UUID. It contains no worker bearer. Poll, report and DELETE validate that
binding and go directly to the original executor, without requiring *new-job*
memory admission. An already running model can therefore consume memory without
losing access to its status or cancellation. Changing readiness cannot move a
running job to another server. Changing worker credentials/target invalidates
existing bindings; administrators must stop/reap jobs before such changes.
Cancellation before upload acknowledgement remains a separate acceptance case;
this increment verifies cleanup after a job UUID has been returned.

The localhost development browser gate and existing public nonpatient-source
authorization remain unchanged. Public production hosting still needs its
separate authenticated clinical deployment design; this increment does not
open that gate.

## Verification boundaries

- `monai-executor-selection.test.ts`: original identity, resource refusal,
  selection, endpoint restrictions, cancellation and signed job affinity.
- `node scripts/check-monai-executor-dev.mjs`: isolated actual Next dev handler
  with two synthetic HTTP workers. It verifies one private upload and continued
  polling/report/deletion after readiness changes. No provider keys, medical
  images or trained inference are used or claimed.
- Existing genuine inference evidence remains distinct. No private original
  worker/checkpoint is configured on the current Mac by this change.
