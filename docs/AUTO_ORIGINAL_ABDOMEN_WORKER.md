# Automatic original abdominal CT: physician does not enter worker tokens

The native one-click CT abdomen research route now first checks the private
same-origin endpoint \`GET /api/local-abdomen\`. When it reports a real live
\`opus-original-abdominal-pathology-worker/v1\` capability with observed
original installed checkpoints, the viewer uses the server-held token
\`OPUS_ABDOMEN_WORKER_TOKEN\`. It does NOT display or transmit the credential
to the clinician browser. Existing original kidney cyst, liver lesion and
MONAI pancreas pathology execution continues **sequentially** on exactly one
DICOM-derived original HU NIfTI. Failure in a model is marked unassessed,
not an absence of pathology. The doctor still grants public nonpatient
research rights before starting analysis.

No new AI model/checkpoint/detector is created or duplicated. The same
\`services/imaging-ai/abdominal_ct_pathology_direct_worker.py\` on
\`127.0.0.1:8775\` is reused with its existing real model-provenance checks.

One-time operator setup on the **same private Linux machine** as Next:
put \`OPUS_ABDOMEN_WORKER_TOKEN\` in an ignored server-only
\`web/.env.local\`; launch the installed original worker with the same
token and origin \`http://127.0.0.1:3000\`. A new public endpoint, wildcard
CORS or model download during every doctor request is NOT introduced.
The server proxies only two fixed routes, verified exact package/models,
a bounded byte-stream to fixed loopback port 8775, and a source-bound
report. It refuses unexpected origin, external host, non-CT bodies, missing
source SHA, absent authorisation, unverified weights, oversize source and
unknown output schema.

The worker may need substantial RAM (especially MONAI pancreatic inference);
this code does not install the original model/checkpoints, create a Linux
systemd service for abdominal workers, prove an independent clinical score,
or assert any patient privacy eligibility. **Do not deploy Next development
service publicly.** Persistent worker deployment and full real DICOM
end-to-end inference remain separate milestones. Manual research worker
session still exists as a fallback while other routes migrate to private
server credentials.
