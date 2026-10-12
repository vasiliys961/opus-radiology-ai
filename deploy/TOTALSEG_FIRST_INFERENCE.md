# First genuine TotalSegmentator CPU inference (Linux server only)

The provisioning workflow from PR #54 succeeded; it did not run the model.
The real-inference entry point is now `scripts/run-totalseg-first-inference.py`.

Prerequisites: separate Linux Docker host with **at least 14 GiB total RAM and 12 GiB currently available**,
Docker Compose, both fully extracted Dataset297/298 model folders from the
offline provisioner, and a **PUBLIC** uncompressed NIfTI CT (`.nii`).
Do not use clinical/patient data for this unvalidated research step. The
container runs with networking disabled, a 12 GiB cap, read-only weights and
bounded execution time. The preflight rejects hosts below 14 GiB installed or 12 GiB currently available (MemAvailable).
Use a disposable dedicated CPU server, not the Mac.

```bash
python scripts/run-totalseg-first-inference.py \
  --input /server/public-ct.nii \
  --models /server/opus-models \
  --output /server/empty-output-dir \
  --research-confirmed
```

It passes the input SHA256 through the actual TotalSegmentator executor,
checks the JSON evidence and generated native-grid mask, and prints elapsed
wall time and label counts. The source NIfTI must respect the bounded 512×512×300
input policy. If it fails, the returned status is failure, not success.
Nothing is uploaded from the server.

**Not yet executed on a real public CT**. The output does not establish
clinical validity, anatomical accuracy, or verified checkpoint provenance.
