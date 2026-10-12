# TotalSegmentator research runner bridge

The standalone `totalsegmentator_runner.py` wires the chosen CT fast lung-lobe
ROI arguments to an injected inference function and validates the original-grid
result using the existing streaming NIfTI validator. It deletes invalid output.

**No real trained inference is enabled**: absent an injected research callable,
execution fails with `isolated_execution_not_connected`. Caller-supplied boolean
authorization is NOT trusted proof of OS egress isolation, weight provenance,
legal rights, or hardware benchmarks. An audited, server-enforced job runner must
supply those guarantees before enabling actual installed TotalSegmentator API.
The research injection permits deterministic contract tests only, with no model
dependencies or DICOM pixel transfer.

No HTTP endpoints, Mac worker changes, cloud requests or .env.local edits.
