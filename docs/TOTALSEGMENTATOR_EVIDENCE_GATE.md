# TotalSegmentator evidence gate (offline, unconnected)

This is an explicit separation of two trust levels: research mask inspection and
verified inference evidence. The inspection routine can call the bounded
native-grid mask validator for externally supplied synthetic/public NIfTI masks,
returning quantitative label counts and source-grid proof, but always marks the
result as **not verified**, **not executed**, and **not ready for MPR import**.

The distinct inference Evidence handoff fails closed. The existing local file
audit contains only **present-unverified** digests and cannot prove official
checkpoint provenance or redistribution/commercial rights. Even user-supplied
checkpoint SHA strings cannot authorize clinical or research execution.
Independent curated official hashes/licenses, secured compute isolation,
source-bound inference manifest, and hardware benchmarks are still missing.
No Torch, model weights, downloads, browser worker, patient data, or .env.local
are touched by this addition.

This code is a trust-boundary increment, not R2 medical inference acceptance.
