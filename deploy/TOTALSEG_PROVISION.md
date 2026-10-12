# Provision verified-run Dataset297/298 archives on a future server

Archive SHA256 values were measured from official GitHub release ZIPs during the
manual Actions run 38303211943. They are pinned here for reproducibility, **not**
independently signed/checkpoint-provenance proof. Licensing review is outstanding.

On a separate Linux server with pre-downloaded, approved public research weights:

```bash
python scripts/provision-totalsegmentator-weights.py \
  --archives /path/to/archives \
  --destination /path/to/new-empty-weights-root \
  --research-provision
```

The destination must NOT exist before invocation. The tool checks both archive
SHA256 values and expected trainer/checkpoint paths before any extraction. It
does not access the network, load Torch, execute inference or modify the Mac.
Mount the resulting weights root read-only at `/models` in
`deploy/compose.totalseg-research.yaml` when a server is available.

Do not upload archives or resulting checkpoints to the public repository.
Future work: server-side license/provenance verification, checkpoint hashes
from extracted bytes, resource benchmarking and actual CT inference.
