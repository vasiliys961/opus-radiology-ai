# Opus Radiology AI: portable model-storage groundwork

This deploy step runs **only the existing read-only TotalSegmentator checkpoint audit**.
It is not the imaging worker, cannot analyze CT, and has **no PyTorch**. Building
the small container may require internet to fetch the official Python base image;
the audit container itself has `network_mode: none` and cannot download models.

Keep code in GitHub and model weights **outside the repository**. Later a CPU/GPU
worker can mount the same weights folder without changing the web application.
Do not store patient images, API keys or licensed weights in GitHub.

On a future Linux machine with Docker/Compose and already installed assets:

```sh
export OPUS_TOTALSEG_WEIGHTS_PATH=/absolute/path/to/nnunet/results
export OPUS_TOTALSEG_CONFIG_PATH=/absolute/path/to/totalsegmentator/config.json
docker compose -f deploy/compose.yaml run --rm weights-audit
```

Both paths must exist on the Docker host and be accessible to uid 10001.
The audit outputs `canRun: false` by design, even with model files present.
Local SHA hashes and package metadata do **not** establish upstream provenance,
license authorization, GPU readiness or clinical safety.

This compose deliberately has no open ports, external network, GPU access,
persisted jobs or production deployment claims. Source images must never be
mounted into the audit container.

Next gated milestone: separately isolated executable AI Worker with curated
checkpoint source/hash/license evidence, restricted model execution and
measured resources. Do not deploy the existing loopback R231 worker with
`127.0.0.1` origins as an internet-facing server.
