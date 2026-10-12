# TotalSegmentator actual API call — research-only Linux execution

This opt-in command **calls the actual** `totalsegmentator.python_api.totalsegmentator`
with `task=total`, `fast=True`, five lung-lobe `roi_subset`, `ml=True`,
and CPU. It verifies the returned native-grid NIfTI against the source and
deletes invalid output. It has never been benchmarked with real weights.

The separate Compose runtime enforces `network_mode: none`, no host ports,
a read-only root FS, no-new-privileges, dropped Linux capabilities, and a
12 GiB RAM ceiling. The host must pre-install the complete official model
cache and supply only PUBLIC/synthetic CT data. **Do not run this on the
8 GiB Mac**. No automatic uploads, downloaded checkpoints or API tokens.
Images should remain only on an explicitly authorized compute machine.

Sample Linux invocation once weights and Docker permissions are independently
verified:

```sh
export OPUS_TOTALSEG_MODEL_HOME=/absolute/path/to/totalseg-home
export OPUS_PUBLIC_CT_NII=/absolute/path/to/public_ct.nii
export OPUS_RESEARCH_OUTPUT_DIR=/absolute/path/to/empty/results
docker compose -f deploy/compose.totalseg-research.yaml run --rm totalseg-research
```

Output cannot be treated as clinically validated or imported into patient
Evidence automatically. Downloaded-archive SHA is not checkpoint provenance.
Review dataset rights/license and full model cache layout independently;
external Docker runtime, exact checkpoint files and end-to-end performance
remain unverified. The existing in-browser R231 service is untouched.
