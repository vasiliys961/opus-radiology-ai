# TotalSegmentator CPU image (optional server-only package smoke test)

This image installs real PyTorch 2.6.0 **CPU wheel** and TotalSegmentator 2.18.0.
Build on a suitable Linux server, not on the Mac M1 8 GB:

```sh
docker compose -f deploy/compose.totalseg-cpu.yaml build
docker compose -f deploy/compose.totalseg-cpu.yaml run --rm totalseg-runtime-probe
```

The image build needs access to PyPI and the official PyTorch CPU wheel index.
The runtime is network-disabled and prints package readiness only.
No weights are mounted, no CT files are imported, no inference is enabled,
and no port is exposed. Disk use and package compatibility have **not yet
been measured by a completed container build**.

Next: independently verify model archives and checkpoint licenses, pin
transitive dependencies (lock or digest-pinned image), measure actual
CPU RAM peaks, and implement a sandboxed inference execution path with
strict job transport and the existing native-grid mask verification.
This is not a production clinical service.
